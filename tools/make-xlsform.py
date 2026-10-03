#!/usr/bin/env python3
"""Writes examples/aidatlas-field-xlsform.xlsx (KoboToolbox / ODK) from AA.exports.XLSFORM in js/exports.js.
Run: python3 tools/make-xlsform.py   (needs: pip install openpyxl; node on PATH)"""
import json, os, subprocess
from openpyxl import Workbook
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
js = "require('%s/js/core.js');require('%s/js/field.js');require('%s/js/exports.js');console.log(JSON.stringify(globalThis.AA.exports.XLSFORM))" % (root, root, root)
form = json.loads(subprocess.check_output(['node', '-e', js]))
wb = Workbook(); wb.remove(wb.active)
for sheet in ('survey', 'choices', 'settings'):
    ws = wb.create_sheet(sheet)
    for row in form[sheet]: ws.append(row)
out = os.path.join(root, 'examples', 'aidatlas-field-xlsform.xlsx')
wb.save(out); print('wrote', out)
