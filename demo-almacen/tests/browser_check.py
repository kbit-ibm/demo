"""End-to-end verification against a running local server, desktop and mobile."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as pw:
 browser=pw.chromium.launch(headless=True)
 page=browser.new_page(viewport={'width':1440,'height':1100},device_scale_factor=1)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:7860');page.wait_for_function("document.querySelector('#status').textContent.includes('Instancia lista')")
 assert page.locator('#initial-cost').inner_text()=='536'
 assert page.locator('#initial-map [data-slot]').count()==10
 page.locator('#initial-map [data-slot="0"]').click();page.locator('#initial-map [data-slot="1"]').click()
 assert 'ajustado' in page.locator('#initial-caption').inner_text()
 # Reset to the reproducible reference by changing seed and back.
 page.locator('#seed').fill('8');page.locator('#seed').press('Tab');page.wait_for_function("!document.querySelector('#seed').disabled")
 page.locator('#seed').fill('7');page.locator('#seed').press('Tab');page.wait_for_function("document.querySelector('#initial-cost').textContent==='536' && !document.querySelector('#seed').disabled")
 page.locator('#run').click();page.wait_for_function("document.querySelector('#status').textContent.includes('Comparación terminada')",timeout=90000)
 assert page.locator('#scores-body tr').count()==5
 assert page.locator('#quantum-map svg').count()==1
 page.locator('#classic-method').select_option('local');assert page.locator('#classical-cost').inner_text()=='340'
 page.locator('[data-view=relations]').click()
 page.locator('#all-pairs').click();assert page.locator('#pairs-body tr').count()==45
 page.locator('[data-view=comparison]').click()
 with page.expect_download() as download:page.locator('#download').click()
 file=download.value;file.save_as(ROOT/'review/browser-result.json')
 result=json.loads((ROOT/'review/browser-result.json').read_text());assert len(result['results'])==5
 assert sum(p['after_cost'] for p in result['results'][-1]['pairs'])==result['results'][-1]['cost']
 page.screenshot(path=ROOT/'review/desktop.png',full_page=True)
 page.set_viewport_size({'width':390,'height':844});page.screenshot(path=ROOT/'review/mobile.png',full_page=True)
 assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth'), 'Mobile overflow'
 page.set_viewport_size({'width':1440,'height':1100})
 page.locator('#scenario').select_option('original');page.wait_for_function("document.querySelector('#initial-map [data-slot]') && document.querySelectorAll('#initial-map [data-slot]').length===32 && !document.querySelector('#run').disabled")
 page.locator('#run').click();page.wait_for_function("document.querySelector('#status').textContent.includes('Comparación terminada')",timeout=90000)
 assert 'No disponible' in page.locator('#scores-body').inner_text()
 assert page.locator('#initial-map [data-slot]').count()==32
 page.locator('[data-view=data-view]').click()
 assert page.locator('#month-detail').is_visible()
 page.locator('[data-view=comparison]').click()
 page.screenshot(path=ROOT/'review/original-desktop.png',full_page=True)
 page.set_viewport_size({'width':390,'height':844});page.screenshot(path=ROOT/'review/original-mobile.png',full_page=True)
 assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
 assert not errors,errors
 browser.close()
 print('OK: navegador real, cinco métodos, dos instancias, inicio manual, cambio de solver, 45 parejas, exportación y escritorio/móvil sin desbordamiento ni errores JS.')
