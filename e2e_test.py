"""End-to-end test + screenshots. Run with the server up: python3 e2e_test.py"""
import re, json, datetime, urllib.request
from playwright.sync_api import sync_playwright, expect
B = "http://localhost:3030"; S = "screenshots/"
d = lambda n: (datetime.date.today() + datetime.timedelta(days=n)).isoformat()
def avail(slug, date): return {p["code"]: p for p in json.load(urllib.request.urlopen(f"{B}/api/availability?hotel={slug}&date={date}"))["passes"]}
DATE = d(0)
with sync_playwright() as pw:
    br = pw.chromium.launch(channel="chrome")
    for name, vp in [("desktop", dict(width=1440, height=900)), ("mobile", dict(width=390, height=844))]:
        ctx = br.new_context(viewport=vp, device_scale_factor=2 if name == "mobile" else 1); pg = ctx.new_page()
        pg.goto(B + "/"); pg.wait_for_load_state("networkidle"); pg.screenshot(path=f"{S}home-{name}.png", full_page=True)
        before = avail("skyline-rooftop", DATE)["pool"]["remaining"]
        pg.goto(f"{B}/h/skyline-rooftop?date={DATE}"); pg.wait_for_selector("input[name=pass]")
        pg.check("input[value=pool]"); pg.select_option("#qty", "2"); pg.wait_for_timeout(300)
        pg.screenshot(path=f"{S}listing-{name}.png", full_page=True)
        pg.click("#go"); pg.wait_for_url(re.compile("/checkout"))
        pg.fill("input[name=name]", f"Test Guest {name}"); pg.fill("input[name=email]", "test@example.com"); pg.fill("input[name=phone]", "0412 345 678")
        pg.check("input[type=checkbox]"); pg.screenshot(path=f"{S}checkout-{name}.png", full_page=True)
        pg.click("button[type=submit]"); pg.wait_for_url(re.compile("/booking/HDC-"))
        code = pg.inner_text(".code"); assert pg.locator("img.qr").count() == 1
        pg.screenshot(path=f"{S}confirmation-{name}.png", full_page=True)
        after = avail("skyline-rooftop", DATE)["pool"]["remaining"]; assert after == before - 2, (before, after)
        print(name, "booked", code, "pool remaining", before, "->", after)
        # hotel dashboard
        pg.goto(B + "/hotel/login"); pg.fill("input[name=user]", "demo-skyline"); pg.fill("input[name=pass]", "demo1234"); pg.click("form >> nth=0 >> button")
        pg.wait_for_url(B + "/hotel"); assert code in pg.inner_text("#today")
        pg.fill("input[name=q]", code); pg.click("#lookup button"); assert code in pg.inner_text("#lookup")
        pg.locator(f"#lookup tr:has-text('{code}') button").click(); pg.wait_for_load_state()
        assert "Checked in" in pg.inner_text(".flash") and "Checked in" in pg.locator(f"#lookup tr:has-text('{code}')").inner_text()
        print(name, "checked in OK")
        if name == "desktop":
            # cap change -> availability (use a future day)
            fd = d(5); sold = avail("skyline-rooftop", fd)["pool"]["sold"]
            pg.goto(B + "/hotel"); pid = pg.get_attribute("input[name^=cap_] >> nth=0", "name")
            pg.fill(f"input[name={pid}]", str(sold + 1)); pg.click("#settings button"); pg.wait_for_load_state()
            assert avail("skyline-rooftop", fd)["pool"]["remaining"] == 1
            pg.fill(f"input[name={pid}]", str(sold)); pg.click("#settings button"); pg.wait_for_load_state()
            assert avail("skyline-rooftop", fd)["pool"]["remaining"] == 0
            pg.goto(f"{B}/h/skyline-rooftop?date={fd}"); pg.wait_for_selector("input[name=pass]")
            assert pg.locator("input[value=pool]").is_disabled(); print("cap change -> pool sold out on", fd, "OK")
            r = pg.request.post(B + "/book", form=dict(hotel="skyline-rooftop", date=fd, qty="1", **{"pass": "pool"}, name="X", email="x@example.com", phone="0400000000"), max_redirects=0)
            assert r.status == 409, r.status; print("server rejects sold-out booking OK")
            pg.goto(B + "/hotel"); pg.fill(f"input[name={pid}]", "30"); pg.click("#settings button"); pg.wait_for_load_state()
            # seeded sold-out day + blocked date
            assert avail("saltwater-terrace", d(3))["daybed"]["remaining"] == 0
            assert avail("saltwater-terrace", d(10))["pool"]["blocked"]; print("seeded sold-out + blocked dates OK")

        pg.goto(B + "/hotel"); pg.wait_for_load_state("networkidle"); pg.screenshot(path=f"{S}hotel-dashboard-{name}.png", full_page=True)
        pg.goto(B + "/admin/login"); pg.fill("input[name=pass]", "admin1234"); pg.click("button.full"); pg.wait_for_url(B + "/admin")
        assert code in pg.inner_text("#all"); pg.screenshot(path=f"{S}admin-{name}.png", full_page=True); print(name, "admin shows booking OK")
        ctx.close()
    br.close()
print("ALL PASSED")
