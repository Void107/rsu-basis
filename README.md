# RSU Cost Basis Reconciler

**English** | [简体中文](README.zh-CN.md)

A local RSU cost-basis reconciliation and workpaper prototype. A deterministic calculation engine produces reviewable XLSX workpapers using TypeScript, React, Decimal.js, PDF.js and ExcelJS.

**The built-in fictional demo works; the real broker-document workflow is unfinished.** This product does not file tax returns. Passing tests does not establish correctness for all business cases.

## Start here — no coding required

Read the **[Installation and User Guide](INSTALL-AND-USE.md)** for Mac and Windows instructions, button-by-button steps, saved files and troubleshooting. A [Chinese guide](安装与使用指南.md) is also available.

Download the [ready-to-use preview ZIP](distribution/RSU工具-免安装体验包.zip): open the file page and click **Download raw file**. Extract it, open `RSU-Tool.html` in a browser, click **Run built-in demo**, then **Generate and download .xlsx workpaper**.

The page defaults to English. Use **English / 中文** at the top right to switch without losing current results. Reloading resets the language to English and clears the session. Workbook contents retain their original mixed Chinese/English labels; report keys and status codes remain in English.

GitHub's source-code ZIP is not the ready-to-use package. This repository is private, and there is no public download site. The commands below are for maintainers only.

## Access and current scope

No employer, organization, agent or spreadsheet product is required. Anyone with the packaged file can run the fictional demo without an account, invitation or corporate email.

The intended scope is RSU cost-basis workpapers for US tax residents, one tax year and one broker. The real-PDF-to-workpaper workflow is incomplete. Scanned documents, other tax jurisdictions, ESPP, options, multi-state allocation and wash sales are unsupported. Do not bypass validation to broaden scope.

Excel is not required to run the app. Compatible spreadsheet editors can open exported XLSX files, but their formula behavior and formatting require independent validation. There is no agent-specific integration.

## Repository layout

- `rsu-basis/`: application code, tests, locked dependencies and build configuration.
- `files/`: product specifications, design decisions and synthetic examples, primarily in Chinese. Historical design documents may lag behind the implementation.
- `INSTALL-AND-USE.md` / `安装与使用指南.md`: beginner user guides.
- `scripts/package_preview.py`: builds the distribution package from an existing application build.
- `distribution/`: ready-to-use preview ZIP.

## Maintainers: install and verify

Requires Node.js (locally checked with Node 24), npm and Python 3.

```sh
cd rsu-basis
npm ci
npm run ci
```

Checks include TypeScript, the Vite build, Vitest tests and independent Python synthetic-case calculations.

## Maintainers: build and package

```sh
cd rsu-basis
npm run build
```

The output is `rsu-basis/dist/index.html`, a self-contained local browser file. The real PDF path still needs browser-worker and broker-format validation.

From the repository root:

```sh
python3 scripts/package_preview.py
```

The package includes the application, both languages of instructions and file checksums. Only the distribution ZIP is committed; extracted files and temporary outputs are excluded. Rebuild and repackage after source changes.

## Data and version control

Only source code, specifications, synthetic data and attributed public samples belong in Git, along with the explicitly included preview package. Do not commit real tax forms, account records, credentials or personal workpapers. Review other file types for sensitive data before committing.

Dependencies, intermediate builds, local settings and local review notes are excluded. Pushing code to GitHub does not deploy a public website.
