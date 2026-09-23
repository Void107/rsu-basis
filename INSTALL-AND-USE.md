# Installation and User Guide — No Coding Required

For independent preview version 0.4.0. Updated September 23, 2026.

## Read this first

This tool creates reviewable worksheets for RSU stock cost-basis calculations. RSUs are company stock awards that become yours when vesting conditions are met. A workpaper is a record of the calculations for someone to review.

**Only the built-in fictional demo is currently complete. The real broker-PDF workflow is unfinished. Do not use this preview to complete your own tax filing.** Demo stocks, transactions and amounts are fictional. A downloaded workbook is not a filed tax return; this tool does not submit anything to a tax authority.

No registration, corporate email, invitation, agent account or programming tools are required. Ordinary users do not need to type commands.

## 1. What you need

- A computer with a browser. You can start with an existing Chrome or Edge installation.
- The ready-to-use ZIP package supplied by the maintainer. A ZIP bundles files together; extract it before opening the application.
- Optionally, a spreadsheet application that opens `.xlsx` files, such as Excel. You do not need one to run the demo or generate the file.

Instructions below cover Mac and Windows. Not every operating-system, browser or spreadsheet combination has been tested. Phones and tablets are not covered by this guide.

### Getting the package

If you have access to the private GitHub repository, follow the ready-to-use package link on its homepage. On the file page, click “Download raw file,” usually shown as a downward arrow. Otherwise, ask the maintainer for the package. There is no public download website or app-store installer at present. A missing repository page may mean you do not have access.

The package is named `RSU工具-免安装体验包.zip`. The Chinese filename means “RSU tool — no-install preview package.” The same package contains both languages.

**GitHub’s “Code → Download ZIP” downloads source code, not the ready-to-use package.** If you only see folders such as `src` and files such as `package.json`, ask for the packaged version. You do not need to understand those files.

## 2. Open the tool — no installation

### On a Mac

1. Open Finder and go to Downloads.
2. Double-click the package ZIP to extract it.
3. Open the extracted folder and find `RSU-Tool.html`.
4. Right-click the file, choose “Open With,” and select your browser. You can also hold Control while clicking to open this menu.
5. Look for “RSU Cost Basis Workpaper Generator” and “Independent preview.”

### On Windows

1. Open File Explorer and go to Downloads.
2. Right-click the package ZIP, choose “Extract All,” and finish the prompts.
3. Open the extracted folder and find `RSU-Tool.html`. If file extensions are hidden, it may appear as “RSU-Tool,” with HTML document as its file type.
4. Right-click it, choose “Open with,” and select your browser.
5. Look for “RSU Cost Basis Workpaper Generator” and “Independent preview.”

Open the file from the extracted folder, not from a ZIP preview. An address starting with `file:` is normal: the browser is reading a file on your computer. Once downloaded, the demo can run offline.

If your operating system blocks the file, do not disable security protection. Confirm that it came from a maintainer you trust and share the warning text with them.

### Change the language

The page starts in **English**. At the top right, select **中文** for Chinese or **English** to switch back. The selected button is highlighted. Switching keeps the current calculation results and updates the page text, errors and self-check notice. Reloading or reopening the page resets it to English and clears the results.

The exported workbook currently keeps its original mixed Chinese/English labels. The page language does not translate workbook contents. Report field names and status codes remain in English for consistency.

## 3. First run: two buttons

### Step one: run the fictional example

Skip “1. Choose a broker PDF.” You do not need any personal documents.

Find “2. Try the complete workflow with fictional data” and click **Run built-in demo**.

A results table should appear. “Vesting lots / sales” should show `5 / 6`: five stock-vesting lots and six sales. No file has been saved yet.

“Corrected capital gain” is a calculation for this fictional example. “Gain overstatement if copying Form 1099-B” is an example difference in gain, **not a tax refund or promised tax savings**. You do not need to understand every tax term to try the demo.

### Step two: save the workbook

1. Click **Generate and download .xlsx workpaper** below the results.
2. If asked where to save it, select Downloads and choose Save. Some browsers save automatically.
3. Find **RSU-basis-ACME-2024.xlsx** on your computer. Repeated downloads may add `(1)` or a similar suffix.
4. The “Generated” message confirms generation; also locate the actual file to confirm that it was saved.

You have now completed the demonstration: run an example, view results and save a workpaper.

## 4. Read the downloaded workbook

Double-click the `.xlsx` file to open it with a compatible spreadsheet application. If you do not have one, keep the file for later; the web-page demo still works.

Use the worksheet tabs at the bottom and start with **Summary**.

| Tab | Meaning | What to look at |
| --- | --- | --- |
| Summary | Overall results | Start here; some labels remain in Chinese |
| Lots | Vesting lots | Information about each stock batch |
| Sales | Sales transactions | Information about each sale |
| Matching | Matching process | Which lots were matched to each sale |
| 8949 | Transaction workpaper | A review record, not a submitted tax form |
| Sources | Data sources | “synthetic” indicates fictional source data |
| Checks | Selected checks | Passing checks do not validate every tax rule |

Some Summary labels: “调整总额” means total adjustment; “调整后成本基础合计” means total adjusted cost basis; “Proceeds 合计” means total proceeds. “边际税率” means marginal tax rate. You do not need to enter a tax rate to complete this demo.

Treat the workbook as a record of this calculation. You cannot upload an edited workbook back into the application. Editing cells is not guaranteed to update the whole calculation consistently. Make a copy before experimenting and retain the original.

Formula behavior and formatting have not been validated in every editor. If formulas show errors or content is missing, tell the maintainer which application you used and what appeared. Do not file based on those results.

## 5. Share a useful issue report

After running the demo, find “3. Self-check report: review before sharing.” This is diagnostic text for the maintainer; you do not need to understand its technical format.

1. Read the report and decide whether you want to share it.
2. Click **Download JSON** to save `self-check-report.json`. JSON is a text-file format; no additional software is required to save it.
3. Send the file to the maintainer yourself if you choose. The application sends nothing automatically.

You can also use **Copy full report**. If copying is unavailable, use Download JSON instead; some browsers restrict clipboard access for local files.

Include your operating system, browser, page version, the button you clicked and the exact message shown. Do not send real tax documents, account details, identity documents or screenshots with personal information. A passed self-check confirms only the checks listed, not readiness for real tax filing.

## 6. Close, reopen, update or remove

- **Close:** close the browser tab.
- **Reopen:** open `RSU-Tool.html` again and run the demo.
- **Save:** refreshing or closing clears the page’s current results. Files already downloaded remain on your computer.
- **Update:** obtain and extract a newer package, then open its file. There is no automatic updater; an old file does not update itself.
- **Remove:** delete the extracted folder and ZIP. Delete downloaded workbooks and reports separately if you no longer need them.

The application processes documents locally and does not upload them. Saving files in a cloud-synced folder, uploading them to an online spreadsheet, or sending them to others are separate sharing actions. Deleting the app does not recall shared copies.

## 7. Common questions

**I see code instead of a page.** You may have opened the file in a text editor. Close it, right-click `RSU-Tool.html`, then use Open with to choose a browser.

**The page is blank or buttons do not respond.** Confirm the ZIP is extracted and you opened the packaged HTML file. Reopen it once. If the problem continues, report your browser name and version to the maintainer. Do not edit the application code.

**There is no download button.** Run the built-in demo first. The workbook download button appears after successful calculation.

**I cannot find the downloaded file.** Check your browser’s download history and your computer’s Downloads folder. If the browser blocked the download, confirm it is the file you just requested before deciding to allow it. You do not need to disable browser-wide security settings.

**A PDF fails to read or says its broker format is unvalidated.** Real-document support is unfinished. A valid PDF can still be blocked. Do not repeatedly upload personal materials or bypass checks. Use the fictional demo; handle real documents through your existing trusted process.

**Does it support all countries or stock transactions?** No. The intended scope is US tax residents, one tax year and one broker, for RSU cost basis. Even within that scope, the real-PDF workflow is incomplete. Other tax jurisdictions, ESPP, options, multi-state allocation and wash sales are unsupported.

**Can I enter my own data?** There is no completed manual-entry workflow and no Excel or JSON import to replace the demo. Demo results are not your personal results.

**Do I need Excel or an AI agent?** No. A browser runs the demo and generates the file. A compatible spreadsheet editor is needed only to view the XLSX.

**Is this a finished tax-filing service?** No. It is a preview prototype with no payment step and no completed real-tax workflow. It does not replace filing services or professional review.

## For maintainers: packaging

Ordinary users do not need this section.

Follow the project README to install dependencies, run checks and build. From the repository root, run:

```sh
python3 scripts/package_preview.py
```

The script packages the existing `rsu-basis/dist/index.html` with English and Chinese instructions into `distribution/RSU工具-免安装体验包.zip`. It does not build the application. Rebuild first after changing application code.

Distribute the ready-to-use package. Before delivery, manually check extraction, opening, demo calculation, downloading and opening the workbook on the target system, and disclose untested platforms.
