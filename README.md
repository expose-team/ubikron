# Expose for Ubikron

Search people, companies, and schools on [Expose](https://expose.team) from an Ubikron case.

Ubikron runs enrichments through [Mimic](https://www.ubikron.com/mimic/). This repository is a Mimic provider. An analyst clicks an email, phone number, profile URL, or domain and presses play. The report lands on the graph.

Each analyst uses their own Expose API key. One completed search uses one credit on that Expose account. Mimic also counts one call against the key you hand out inside Mimic. Those are two separate meters.

## What you need

- [Mimic CLI](https://github.com/Ubikron-Tech-Farm/mimic-cli) 0.8 or newer, signed in with `mimic login`.
- Python 3.
- An Expose API key from [Access](https://expose.team/platform/access/api).

## Install

```bash
python3 scripts/apply.py
mimic credentials set expose --type api_key
```

`apply.py` reads the main property of each Ubikron entity type, writes `expose.bundle.json`, and imports the provider into the signed-in Mimic account. It does not ask for the Expose key and it does not write that key into a file.

Preview without saving:

```bash
python3 scripts/apply.py --dry-run
```

Run it again after a mapping change:

```bash
python3 scripts/apply.py --update
```

In Ubikron, the enrichments show up on the matching entity:

| You click | Enrichment | Expose search |
| --- | --- | --- |
| Email | Person by email | `type=person&email=` |
| Phone | Person by phone | `type=person&phone=` |
| URL | Person, company, or school by profile URL | `profile_url=` |
| Domain | Company or school by domain | `domain=` |

A name alone is not a search. A phone number needs a country code.

The person card draws the name, emails, phones, aliases, profiles, employer domains, and school domains. The company and school cards draw the domain, websites, and profile URLs. Company and school names stay text, because this provider only uses Ubikron's built-in entity types.

## Keys for a team

Your Expose key stays in your Mimic credential. Teammates get Mimic keys with a call limit, so they can run the enrichment without seeing the Expose key.

On the public Mimic server (`mimic.ubikron.com`), the API key and the identifier pass through Ubikron's server on the way to `https://expose.team`. A private Ubikron server keeps that traffic on your network. Do not put one shared Expose key on a server other people can use.

## Check the mappings

```bash
npm install
npm run check
```

That evaluates the JSONata mappings against sample reports. It does not call Expose or Mimic.
