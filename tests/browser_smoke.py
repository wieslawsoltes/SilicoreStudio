"""Browser integration checks. Requires Playwright; application has no dependencies.

Normal: python tests/browser_smoke.py --url http://localhost:8080
Restricted renderer-only environment: --inline dist/silicore-studio.html
"""
from pathlib import Path
import argparse
import json
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://localhost:8080')
parser.add_argument('--inline')
parser.add_argument('--browser', default='/usr/bin/chromium')
parser.add_argument('--output', default='test-results')
args = parser.parse_args()
output = Path(args.output)
output.mkdir(parents=True, exist_ok=True)
results = []

def record(name, extra=None):
    results.append({'test':name, 'passed':True, **(extra or {})})
    print('PASS', name, extra or '')

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=args.browser, headless=True,
        args=['--no-sandbox', '--enable-unsafe-webgpu', '--use-angle=swiftshader'])
    page = browser.new_page(viewport={'width':1600,'height':1000}, device_scale_factor=1,
                            accept_downloads=True)
    page.set_default_timeout(6000)
    page_errors = []
    page.on('pageerror', lambda e: page_errors.append(str(e)))
    if args.inline:
        page.set_content(Path(args.inline).read_text(), wait_until='load')
    else:
        page.goto(args.url, wait_until='networkidle')
    page.wait_for_function('window.Silicore && window.Silicore.getState().backend !== "initializing"')
    state = lambda: page.evaluate('Silicore.getState()')
    snapshot = lambda: page.evaluate('Silicore.getSnapshot()')
    def idle():
        page.wait_for_function('!Silicore.getState().busy', timeout=60000)
        page.wait_for_timeout(80)
    def point(x,y):
        q=page.evaluate('([x,y])=>Silicore.worldToScreen(x,y)',[x,y])
        r=page.locator('#interaction').bounding_box()
        return (r['x']+q['x'],r['y']+q['y'])
    def view(name):
        page.locator(f'.work-tabs [data-view="{name}"]').click()
        page.wait_for_timeout(70)
    def undo():
        page.locator('.toolbar [data-action="undo"]').click()
        page.wait_for_timeout(70)
    assert state()['primitiveCount']>6000
    record('application boot and retained scene', {'backend':state()['backend'], 'instances':state()['primitiveCount']})
    page.screenshot(path=str(output/'01-layout.png'))

    # Picking and pointer drag are real UI operations, not direct model mutations.
    cell=next(c for c in snapshot()['cells'] if c['kind']=='cell' and 480<c['x']<790 and 450<c['y']<500)
    x,y=point(cell['x']+cell['w']/2,cell['y']+cell['h']/2)
    page.mouse.click(x,y)
    assert cell['id'] in state()['selection']
    page.mouse.move(x,y); page.mouse.down();page.mouse.move(x+30,y+15,steps=6);page.mouse.up()
    changed=next(c for c in snapshot()['cells'] if c['id']==cell['id'])
    assert changed['x']!=cell['x'] and changed['y']!=cell['y']
    undo()
    restored=next(c for c in snapshot()['cells'] if c['id']==cell['id'])
    assert restored['x']==cell['x'] and restored['y']==cell['y']
    record('spatial picking, cell drag and transaction undo')

    page.locator('.tree-row[data-cell="m1"]').click()
    assert state()['selection']==['m1']
    page.locator('input[data-prop="fixed"]').uncheck()
    assert snapshot()['cells'][0]['fixed'] is False
    page.locator('input[data-prop="x"]').fill('120')
    page.locator('input[data-prop="x"]').press('Tab')
    assert snapshot()['cells'][0]['x']==120
    undo();undo()
    assert snapshot()['cells'][0]['fixed'] is True and snapshot()['cells'][0]['x']==99
    record('macro property editing and fixed placement')
    page.locator('.toolbar [data-action="fit"]').click()

    before=len(snapshot()['cells'])
    page.locator('[data-tool="macro"]').click()
    a=point(420,280);b=point(500,325)
    page.mouse.move(*a);page.mouse.down();page.mouse.move(*b,steps=5);page.mouse.up()
    assert len(snapshot()['cells'])==before+1
    undo()
    assert len(snapshot()['cells'])==before
    record('interactive macro creation')

    page.locator('[data-tool="route"]').click()
    cells=[c for c in snapshot()['cells'] if c['kind']=='cell' and 450<c['x']<700 and 420<c['y']<470]
    before=len(snapshot()['nets'])
    for c in (cells[0],cells[-1]):
        page.mouse.click(*point(c['x']+c['w']/2,c['y']+c['h']/2))
    assert len(snapshot()['nets'])==before+1
    undo()
    assert len(snapshot()['nets'])==before
    record('interactive net creation')

    before=state()['primitiveCount']
    page.locator('input[data-layer="M1"]').uncheck()
    assert state()['primitiveCount']<before
    page.locator('input[data-layer="M1"]').check()
    assert state()['primitiveCount']==before
    record('layer visibility changes render submission')

    page.locator('[data-tool="measure"]').click()
    a=point(500,450);b=point(600,450)
    page.mouse.move(*a);page.mouse.down();page.mouse.move(*b,steps=4);page.mouse.up()
    assert '100.00' in page.locator('#statusMessage').inner_text()
    record('world-space measurement')

    view('schematic')
    assert page.locator('.schematic-node').count()==14
    input_node=page.locator('[data-input-toggle="req"]')
    before=input_node.locator('text').last.text_content()
    input_node.locator('text').first.click()
    assert input_node.locator('text').last.text_content()!=before
    record('schematic signal evaluation and toggling')
    page.screenshot(path=str(output/'02-schematic.png'))

    first=snapshot()['logic']['gates'][0]
    page.locator(f'[data-gate="{first["id"]}"]').click(position={"x":30,"y":20})
    page.locator('#gateType').select_option('OR')
    assert snapshot()['logic']['gates'][0]['type']=='OR'
    assert ' | ' in snapshot()['hdl']
    undo()
    assert snapshot()['logic']['gates'][0]['type']==first['type']
    record('schematic gate editing and HDL regeneration')

    # A cycle must leave both model and geometry unchanged.
    before=snapshot()['logic']
    gid=before['gates'][0]['id']
    page.locator(f'[data-source="{gid}"]').click()
    page.locator(f'[data-target="{gid}"][data-pin="0"]').click()
    assert snapshot()['logic']==before
    assert 'cycle' in page.locator('.toast.error').last.inner_text().lower()
    record('cyclic schematic connection rejected atomically')

    view('rtl')
    source='module adder(input wire [7:0] a, input wire [7:0] b, output wire [7:0] sum, output wire different);\nassign sum = a + b;\nassign different = a != b;\nendmodule\n'
    page.locator('#hdlEditor').fill(source)
    page.locator('#rtlView [data-action="synthesize"]').click()
    idle()
    assert snapshot()['logic']['name']=='adder'
    assert page.evaluate('Silicore.evaluate({a:250,b:10}).outputs')=={'sum':4,'different':1}
    assert snapshot()['hdl']==source
    record('worker-based HDL synthesis and unsigned bus arithmetic')
    page.screenshot(path=str(output/'03-rtl.png'))

    # Unsupported input must produce diagnostics without replacing the last good model.
    old=snapshot()['logic']
    page.locator('#hdlEditor').fill('module bad(input a, output y); always @(*) y=a; endmodule')
    page.locator('#rtlView [data-action="synthesize"]').click()
    idle()
    assert page.locator('#editorDiagnostic').is_visible()
    assert snapshot()['logic']==old
    page.locator('#hdlEditor').fill(source)
    record('unsupported HDL reports diagnostics without corrupting the design')

    view('wave')
    page.locator('#waveView [data-action="simulate"]').click()
    idle()
    assert page.locator('#waveSvg').count()==1
    page.locator('#waveView [data-action="step"]').click()
    assert state()['cursor']==1
    page.locator('#waveView [data-action="resetSim"]').click()
    assert state()['cursor']==0
    page.screenshot(path=str(output/'04-waveforms.png'))
    record('worker simulation, trace rendering and cursor controls')

    view('layout')
    page.locator('#runFlow').click()
    idle()
    assert not state()['busy']
    assert 'Implementation complete' in page.locator('#statusMessage').inner_text()
    assert 'A* routing:' in page.locator('#logs').inner_text()
    record('complete placement/routing/timing/check worker flow', {'checks':state()['checks'], 'wns':state()['wns']})

    page.locator('[data-menu="File"]').click()
    with page.expect_download(timeout=5000) as download_info:
        page.locator('#menuPopup [data-action="save"]').click()
    export_file=output/'roundtrip.silicore'
    download_info.value.save_as(str(export_file))
    data=json.loads(export_file.read_text())
    assert data['schema']=='silicore/1'
    record('actual project download')
    page.locator('#fileInput').set_input_files(str(export_file))
    page.wait_for_timeout(500)
    assert snapshot()['logic']['name']=='adder'
    record('actual project-file import roundtrip')

    bad={'schema':'wrong'}
    before=snapshot()
    page.locator('#fileInput').set_input_files({'name':'bad.json','mimeType':'application/json','buffer':json.dumps(bad).encode()})
    page.wait_for_timeout(100)
    assert snapshot()==before
    record('invalid imported schema leaves model unchanged')

    page.locator('.command-trigger').click()
    page.locator('#paletteInput').fill('Open logic schematic')
    page.locator('#paletteInput').press('Enter')
    assert state()['view']=='schematic'
    record('command palette search and invocation')

    page.locator('[data-menu="File"]').click()
    page.locator('#menuPopup [data-action="new"]').click()
    page.locator('[data-action="confirmNew"]').click()
    assert snapshot()['name']=='aurora_top' and len(snapshot()['cells'])==1100
    record('reference fixture reset')

    page.set_viewport_size({'width':1280,'height':800})
    page.wait_for_timeout(150)
    page.locator('.toolbar [data-action="fit"]').click()
    assert page.evaluate('document.documentElement.scrollWidth<=1280')
    page.screenshot(path=str(output/'05-compact.png'))
    record('compact desktop layout at 1280×800')
    page.set_viewport_size({'width':1600,'height':1000})
    page.locator('.toolbar [data-action="fit"]').click()
    page.screenshot(path=str(output/'06-final-layout.png'))
    assert page_errors==[], page_errors
    record('zero uncaught browser exceptions')
    report={'tests':results,'passed':len(results),'backend':state()['backend'],'pageErrors':page_errors,
            'note':'Inline mode has an opaque origin: localStorage and browser WebGPU are unavailable. No hardware performance claim is made.' if args.inline else 'Served-origin browser checks.'}
    (output/'browser-results.json').write_text(json.dumps(report,indent=2))
    browser.close()
    print(json.dumps({'passed':len(results),'backend':report['backend']}))
