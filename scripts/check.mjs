import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import jsonata from "jsonata";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function titlecase(value) {
  if (value == null) return value;
  return String(value).replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}

function date(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return value;
}

function yesNo(value) {
  const text = String(value).trim().toLowerCase();
  return value === true || value === 1 || text === "true" || text === "yes" || text === "1" ? "Yes" : "No";
}

async function evaluate(expression, data, bindings) {
  const compiled = jsonata(expression);
  compiled.registerFunction("titlecase", titlecase);
  compiled.registerFunction("date", date);
  compiled.registerFunction("yesNo", yesNo);
  return compiled.evaluate(data, bindings);
}

function organizationSpec(title) {
  const spec = readJson("mappings/organization.json");
  for (const section of spec.sections) {
    if (section.titleExpression === "__TITLE__") section.titleExpression = `'${title}'`;
  }
  return spec;
}

const failures = [];

function asList(value) {
  if (value == null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function expect(label, actual, expected) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) failures.push(`${label}\n  got ${left}\n  want ${right}`);
}

function expectList(label, actual, expected) {
  expect(label, asList(actual), expected);
}

async function bindRecords(spec, data) {
  const records = await evaluate(spec.variables[0].expression, data, {});
  return { records };
}

async function checkPerson() {
  const spec = readJson("mappings/person.json");
  const hit = readJson("samples/person.json");
  const bindings = {
    ...(await bindRecords(spec, hit)),
    input: { mainProperty: { value: "jane.doe@example.com" } },
  };
  const match = spec.sections.find((section) => section.ref === "match");
  const records = bindings.records;
  expect("person records", records.length, 1);
  const row = records[0];
  const rowBindings = { ...bindings, input: bindings.input };
  expect("person name", await evaluate(match.itemTitleExpression, row, rowBindings), "Jane Doe");

  const fields = Object.fromEntries(
    match.blocks.find((block) => block.kind === "properties").fields.map((field) => [field.ref, field.expression]),
  );
  expectList("emails", await evaluate(fields.emails, row, rowBindings), ["jane.doe@example.com"]);
  expectList("phones", await evaluate(fields.phones, row, rowBindings), ["+12025550123"]);
  expectList("aliases", await evaluate(fields.aliases, row, rowBindings), ["janedoe"]);
  expectList("profiles", await evaluate(fields.profiles, row, rowBindings), [
    "https://linkedin.com/in/janedoe",
    "http://janedoe.io",
  ]);
  expectList("employers", await evaluate(fields.employers, row, rowBindings), ["acme.com"]);
  expectList("schools", await evaluate(fields.schools, row, rowBindings), ["stanford.edu"]);
  expect("skills", await evaluate(fields.skills, row, rowBindings), "product management, sql");
  expectList("locations", await evaluate(fields.locations, row, rowBindings), ["San Francisco, Ca, United States"]);

  const experience = match.blocks.find((block) => block.table?.ref === "experience").table;
  const job = (await evaluate(experience.sourceExpression, row, rowBindings))[0];
  expect("role", await evaluate(experience.columns[0].expression, job, rowBindings), "Product Manager");
  expect("started", await evaluate(experience.columns[4].expression, job, rowBindings), "2020-05-01");
  expect("current", await evaluate(experience.columns[3].expression, job, rowBindings), "Yes");

  const empty = readJson("samples/person-empty.json");
  const emptyBindings = {
    ...(await bindRecords(spec, empty)),
    input: { mainProperty: { value: "nobody@example.com" } },
  };
  expect("empty records", emptyBindings.records, []);
  const miss = spec.sections.find((section) => section.ref === "miss");
  expect(
    "miss searched",
    await evaluate(miss.blocks[0].fields[0].expression, empty, emptyBindings),
    "nobody@example.com",
  );

  const list = readJson("samples/person-list.json");
  const listed = await bindRecords(spec, list);
  expect("list length", listed.records.length, 2);
  expect(
    "second name",
    await evaluate(match.itemTitleExpression, listed.records[1], { ...listed, input: bindings.input }),
    "John Doe",
  );
}

async function checkOrganization(samplePath, title, expectations) {
  const spec = organizationSpec(title);
  const body = readJson(samplePath);
  const bindings = {
    ...(await bindRecords(spec, body)),
    input: { mainProperty: { value: expectations.searched } },
  };
  const match = spec.sections.find((section) => section.ref === "match");
  expect(`${title} title literal`, match.titleExpression, `'${title}'`);
  const row = bindings.records[0];
  expect(`${title} name`, await evaluate(match.itemTitleExpression, row, bindings), expectations.name);
  const fields = Object.fromEntries(
    match.blocks.find((block) => block.kind === "properties").fields.map((field) => [field.ref, field.expression]),
  );
  expect(`${title} domain`, await evaluate(fields.domain, row, bindings), expectations.domain);
  expectList(`${title} websites`, await evaluate(fields.websites, row, bindings), expectations.websites);
  expectList(`${title} profiles`, await evaluate(fields.profiles, row, bindings), expectations.profiles);
  expectList(`${title} industries`, await evaluate(fields.industries, row, bindings), expectations.industries);
}

await checkPerson();
await checkOrganization("samples/company.json", "Company", {
  searched: "acme.com",
  name: "Acme Inc",
  domain: "acme.com",
  websites: ["https://www.acme.com"],
  profiles: ["https://linkedin.com/company/acme"],
  industries: ["Software Development"],
});
await checkOrganization("samples/school.json", "School", {
  searched: "stanford.edu",
  name: "Stanford University",
  domain: "stanford.edu",
  websites: ["https://www.stanford.edu"],
  profiles: ["https://linkedin.com/school/stanford-university"],
  industries: ["Higher Education"],
});

const bundle = readJson("bundle/expose.json");
const endpoints = bundle.providers[0].endpoints;
const mappings = new Set(endpoints.map((endpoint) => endpoint.mapping));
if (![...mappings].every((name) => ["person", "company", "school"].includes(name))) {
  failures.push(`unexpected mapping names ${[...mappings].join(",")}`);
}
for (const endpoint of endpoints) {
  if (!endpoint.endpoint_url.includes("{{__INPUT__}}")) failures.push(`${endpoint.slug} is missing the input placeholder`);
  if (endpoint.request_config.headers["x-api-key"] !== "{{api_key}}") failures.push(`${endpoint.slug} is missing the API key header`);
  if (JSON.stringify(bundle).includes("EXPOSE_API_KEY") || JSON.stringify(bundle).match(/sk_|mk_/)) {
    failures.push("bundle contains a secret");
  }
}

if (failures.length) {
  console.error(failures.join("\n\n"));
  process.exit(1);
}
console.log(`checked ${endpoints.length} endpoints against the sample reports`);
