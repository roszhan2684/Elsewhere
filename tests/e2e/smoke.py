"""Browser smoke test of the canonical demo and the new-decision flow.

    BASE_URL=http://localhost:3000 services/api/.venv/bin/python tests/e2e/smoke.py
"""
import asyncio, os, sys
from playwright.async_api import async_playwright
OUT = os.environ.get("SHOTS", "/tmp/elsewhere-shots")
B = os.environ.get("BASE_URL", "http://localhost:3000")

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch()
        pg = await br.new_page(viewport={"width": 1440, "height": 900})
        errs = []
        pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
        await pg.goto(B + "/"); await pg.wait_for_timeout(800)
        await pg.screenshot(path=f"{OUT}/1-landing.png")
        await pg.mouse.wheel(0, 700); await pg.wait_for_timeout(600)
        await pg.screenshot(path=f"{OUT}/2-landing-split.png")
        await pg.goto(B + "/demo/startup-sf-vs-seattle"); await pg.wait_for_selector("text=Talk to your futures"); await pg.wait_for_timeout(600)
        await pg.screenshot(path=f"{OUT}/3-demo.png", full_page=True)
        # ask a debate question (forks the demo, runs live/mock)
        await pg.fill("#ask", "How is money, honestly?")
        await pg.click("button[type=submit]:has-text('Ask')")
        await pg.wait_for_timeout(9000)
        await pg.screenshot(path=f"{OUT}/4-debate.png", full_page=False)
        # click first chip in chat
        chips = pg.locator("[role=tabpanel] button[aria-label^='Show evidence']")
        if await chips.count():
            await chips.first.click(); await pg.wait_for_timeout(300)
        await pg.locator("#evidence").screenshot(path=f"{OUT}/5-evidence.png")
        await pg.click("role=tab[name=/Stress test/]")
        await pg.click("button:has-text('Apply shock to both worlds')")
        await pg.wait_for_selector("text=The Elsewhere Ledger", timeout=60000); await pg.wait_for_timeout(800)
        await pg.screenshot(path=f"{OUT}/6-shock.png", full_page=True)
        await pg.click("role=tab[name=/What decides this/]"); await pg.wait_for_timeout(500)
        await pg.locator("[role=tabpanel]").screenshot(path=f"{OUT}/7-decides.png")
        await pg.click("role=tab[name=/Under the hood/]"); await pg.wait_for_timeout(800)
        await pg.locator("[role=tabpanel]").screenshot(path=f"{OUT}/8-hood.png")
        await pg.click("role=tab[name=/Postcards/]"); await pg.wait_for_timeout(500)
        await pg.locator("[role=tabpanel]").screenshot(path=f"{OUT}/9-postcards.png")
        # new flow
        await pg.goto(B + "/new"); await pg.wait_for_timeout(500)
        await pg.click("text=I'm thinking about quitting my job")
        await pg.click("button:has-text('Continue')")
        await pg.wait_for_selector("text=Here’s what I heard", timeout=20000)
        await pg.screenshot(path=f"{OUT}/10-review.png", full_page=True)
        await pg.click("button:has-text('Build my two worlds')")
        await pg.wait_for_url("**/sim/**"); await pg.wait_for_timeout(1500)
        await pg.screenshot(path=f"{OUT}/11-loading.png")
        await pg.wait_for_selector("text=Talk to your futures", timeout=60000); await pg.wait_for_timeout(500)
        await pg.screenshot(path=f"{OUT}/12-sim.png")
        m = await br.new_page(viewport={"width": 390, "height": 844})
        await m.goto(B + "/demo/startup-sf-vs-seattle"); await m.wait_for_selector("text=Talk to your futures"); await m.wait_for_timeout(500)
        await m.screenshot(path=f"{OUT}/13-mobile.png", full_page=True)
        sw = await m.evaluate("document.documentElement.scrollWidth")
        print("mobile scrollWidth", sw)
        print("\n".join(errs[:30]) or "no console errors")
        await br.close()
        if errs or sw > 390:
            sys.exit(1)

os.makedirs(OUT, exist_ok=True)
asyncio.run(main())
