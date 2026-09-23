"""Package the existing single-file preview with beginner instructions (stdlib only)."""
from pathlib import Path
import hashlib
import html
import re
import zipfile

root = Path(__file__).resolve().parents[1]
app = root / "rsu-basis/dist/index.html"
guide = root / "安装与使用指南.md"
if not app.is_file():
    raise SystemExit("缺少构建文件，请先在 rsu-basis 中运行 npm run build。")

output = root / "distribution"
output.mkdir(exist_ok=True)
name = "RSU工具-免安装体验包"
guide_text = guide.read_text(encoding="utf-8").split("## 给维护者：")[0]
guide_text = guide_text.replace("英文版：[Installation and User Guide](INSTALL-AND-USE.md)。", "")
english_text = (root / "INSTALL-AND-USE.md").read_text(encoding="utf-8").split("## For maintainers:")[0]


def inline(text):
    text = html.escape(text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    return re.sub(r"`([^`]+)`", r"<code>\1</code>", text)


def render_guide(text):
    """Render the headings, paragraphs, lists and table used by our guide."""
    parts, group = [], None
    for line in text.splitlines() + [""]:
        kind = "ul" if line.startswith("- ") else "ol" if re.match(r"\d+\. ", line) else "table" if line.startswith("|") else None
        if kind != group and group:
            parts.append(f"</{group}>")
            group = None
        if kind and not group:
            parts.append(f"<{kind}>")
            group = kind
        if kind in ("ul", "ol"):
            parts.append("<li>" + inline(re.sub(r"^(?:- |\d+\. )", "", line)) + "</li>")
        elif kind == "table":
            cells = [cell.strip() for cell in line.strip("|").split("|")]
            if all(re.fullmatch(r":?-+:?", cell) for cell in cells):
                continue
            tag = "th" if cells[0] in ("标签", "Tab") else "td"
            parts.append("<tr>" + "".join(f"<{tag}>{inline(cell)}</{tag}>" for cell in cells) + "</tr>")
        elif line.startswith("#"):
            heading, content = line.split(" ", 1)
            parts.append(f"<h{len(heading)}>{inline(content)}</h{len(heading)}>")
        elif line.strip():
            parts.append("<p>" + inline(line) + "</p>")
    return "\n".join(parts)


help_page = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>安装与使用指南</title>
<style>body{max-width:860px;margin:40px auto;padding:0 24px;font-family:system-ui,sans-serif;line-height:1.8;color:#222}a{color:#1457bd}table{border-collapse:collapse;display:block;overflow-x:auto}td,th{border:1px solid #ddd;padding:8px;text-align:left}h2{margin-top:2em}code{overflow-wrap:anywhere;background:#f4f4f4}li{margin:8px 0}</style>
<body><p><a href="User-Guide.html" lang="en">English guide</a> | <a href="RSU工具.html">打开 RSU 工具（假数据演示）</a></p>''' + render_guide(guide_text) + "</body></html>"
english_page = help_page[:help_page.index('<body>')].replace('lang="zh-CN"', 'lang="en"').replace('<title>安装与使用指南</title>', '<title>Installation and User Guide</title>') + '<body><p><a href="安装与使用指南.html" lang="zh-CN">中文说明</a> | <a href="RSU-Tool.html">Open the RSU tool (fictional demo)</a></p>' + render_guide(english_text) + '</body></html>'
start = """先读我：这是什么？

这是 RSU 成本基础工具的免安装演示包，无需注册或输入命令。
当前只能完整体验假数据演示，不能用于完成真实报税。

1. 先解压整个压缩包。
2. 用浏览器打开“安装与使用指南.html”，查看详细步骤。
3. 用浏览器打开“RSU工具.html”。
4. 先点右上角“中文”，再跳过 PDF 上传，点击“运行内置合成案例”。
5. 点击“生成并下载 .xlsx 底稿”，在下载文件夹找表格。

如果双击后显示代码，请右键文件 → 打开方式 → 选择浏览器。
无需安装插件、编程工具，也无需登录任何组织账号。
关闭页面会清除页面内的结果；已下载的文件不会被清除。
"""
payloads = {
    "RSU工具.html": app.read_bytes(),
    "RSU-Tool.html": app.read_bytes(),
    "安装与使用指南.html": help_page.encode("utf-8"),
    "User-Guide.html": english_page.encode("utf-8"),
    "START-HERE.txt": """RSU Cost Basis Tool — independent preview

No installation, account or coding required. Fictional demo only: not for real tax filing.

1. Extract the ZIP completely.
2. Open User-Guide.html in a browser for full instructions.
3. Open RSU-Tool.html in a browser. The page starts in English.
4. Skip the PDF upload and click Run built-in demo.
5. Click Generate and download .xlsx workpaper; check Downloads for the file.

Use English / 中文 at the top right to change the page language.
If you see code, right-click the HTML file and choose Open with > a browser.
Closing or refreshing clears the current session; downloaded files remain.
The exported workbook retains its original mixed Chinese/English labels.
RSU-Tool.html and RSU工具.html are identical application copies; open either one.
""".encode("utf-8-sig"),
    "先读我.txt": start.encode("utf-8-sig"),
}
checksums = "".join(f"{hashlib.sha256(data).hexdigest()}  {filename}\n" for filename, data in payloads.items())
payloads["SHA256SUMS.txt"] = checksums.encode("utf-8")
archive = output / f"{name}.zip"
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
    for filename, data in payloads.items():
        bundle.writestr(f"{name}/{filename}", data)
print(f"已生成：{archive}")
