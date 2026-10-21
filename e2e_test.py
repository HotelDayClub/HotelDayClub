"""End-to-end test + screenshots. Run with the server up: python3 e2e_test.py"""
import re, json, datetime, urllib.request
from playwright.sync_api import sync_playwright, expect
B = "http://localhost:3030"; S = "screenshots/"
d = lambda n: (datetime.date.today() + datetime.timedelta(days=n)).isoformat()
def avail(slug, date): return {p["code"]: p for p in json.load(urllib.request.urlopen(f"{B}/api/availability?hotel={slug}&date={date}"))["passes"]}
DATE = d(0)
def skyline_day(start=1):
    blocked = {d(11), d(24)}
    for i in range(start, 14):
        day = datetime.date.today() + datetime.timedelta(days=i)
        if day.weekday() > 3 or day.isoformat() in blocked: continue
        return day.isoformat()
    return d(1)
with sync_playwright() as pw:
    br = pw.chromium.launch(channel="chrome")
    for name, vp in [("desktop", dict(width=1440, height=900)), ("mobile", dict(width=390, height=844))]:
        ctx = br.new_context(viewport=vp, device_scale_factor=2 if name == "mobile" else 1); pg = ctx.new_page()
        pg.goto(B + "/"); pg.wait_for_load_state("networkidle"); pg.screenshot(path=f"{S}home-{name}.png", full_page=True)
        book_date = DATE if avail("skyline-rooftop", DATE).get("chair", {}).get("remaining", 0) >= 2 and not avail("skyline-rooftop", DATE)["chair"].get("blocked") else skyline_day()
        before = avail("skyline-rooftop", book_date)["chair"]["remaining"]
        pg.goto(f"{B}/h/skyline-rooftop?date={book_date}"); pg.wait_for_selector("input[name=pass]")
        pg.check("input[value=chair]"); pg.select_option("#qty", "2"); pg.wait_for_timeout(300)
        pg.screenshot(path=f"{S}listing-{name}.png", full_page=True)
        pg.click("#go"); pg.wait_for_url(re.compile("/checkout"))
        pg.fill("input[name=name]", f"Test Guest {name}"); pg.fill("input[name=email]", "test@example.com"); pg.fill("input[name=phone]", "0412 345 678")
        pg.check("input[name=rules]"); pg.screenshot(path=f"{S}checkout-{name}.png", full_page=True)
        pg.click("button[type=submit]"); pg.wait_for_url(re.compile("/booking/HDC-"))
        code = pg.inner_text(".code"); assert pg.locator("img.qr").count() == 1
        pg.screenshot(path=f"{S}confirmation-{name}.png", full_page=True)
        after = avail("skyline-rooftop", book_date)["chair"]["remaining"]; assert after == before - 2, (before, after, book_date)
        print(name, "booked", code, "chair remaining", before, "->", after, book_date)
        # hotel dashboard
        pg.goto(B + "/hotel/login"); pg.fill("input[name=user]", "demo-skyline"); pg.fill("input[name=pass]", "demo1234"); pg.click("form >> nth=0 >> button")
        pg.wait_for_url(B + "/hotel"); assert code in pg.inner_text("#today" if book_date == DATE else "#upcoming")
        pg.fill("input[name=q]", code); pg.click("#lookup button"); assert code in pg.inner_text("#lookup")
        if book_date == DATE:
            pg.locator(f"#lookup tr:has-text('{code}') button").click(); pg.wait_for_load_state()
            assert "Checked in" in pg.inner_text(".flash") and "Checked in" in pg.locator(f"#lookup tr:has-text('{code}')").inner_text()
            print(name, "checked in OK")
        else:
            print(name, "same-day already closed; lookup OK for", book_date)
        if name == "desktop":
            # cap change -> availability (use a future day)
            fd = skyline_day(); sold = avail("skyline-rooftop", fd)["chair"]["sold"]
            pg.goto(B + "/hotel/settings"); cap = pg.locator("#settings input[name=cap]").nth(0)
            assert cap.get_attribute("data-code") == "chair"
            original = cap.input_value()
            cap.fill(str(sold + 1)); pg.click("#settings button[type=submit]"); pg.wait_for_load_state("networkidle")
            assert avail("skyline-rooftop", fd)["chair"]["remaining"] == 1
            pg.locator("#settings input[name=cap]").nth(0).fill(str(sold)); pg.click("#settings button[type=submit]"); pg.wait_for_load_state("networkidle")
            assert avail("skyline-rooftop", fd)["chair"]["remaining"] == 0
            pg.goto(f"{B}/h/skyline-rooftop?date={fd}"); pg.wait_for_selector("input[name=pass]")
            assert pg.locator("input[value=chair]").is_disabled(); print("cap change -> chair sold out on", fd, "OK")
            r = pg.request.post(B + "/book", form=dict(hotel="skyline-rooftop", date=fd, qty="1", **{"pass": "chair"}, name="X", email="x@example.com", phone="0400000000"), max_redirects=0)
            assert r.status == 409, r.status; print("server rejects sold-out booking OK")
            pg.goto(B + "/hotel/settings"); pg.locator("#settings input[name=cap]").nth(0).fill(original); pg.click("#settings button[type=submit]"); pg.wait_for_load_state("networkidle")
            # seeded sold-out day + blocked date
            blocked = {d(10), d(24)}
            sold_day = next(d(i) for i in range(1, 12) if datetime.date.fromisoformat(d(i)).weekday() < 5 and d(i) not in blocked)
            assert avail("saltwater-terrace", sold_day)["daybed"]["remaining"] == 0
            assert avail("saltwater-terrace", d(10))["lounger"]["blocked"]; print("seeded sold-out + blocked dates OK")

        pg.goto(B + "/hotel"); pg.wait_for_load_state("networkidle"); pg.screenshot(path=f"{S}hotel-dashboard-{name}.png", full_page=True)
        pg.goto(B + "/admin/login"); pg.fill("input[name=pass]", "admin1234"); pg.click("button.full"); pg.wait_for_url(B + "/admin")
        assert code in pg.inner_text("#all"); pg.screenshot(path=f"{S}admin-{name}.png", full_page=True); print(name, "admin shows booking OK")
        ctx.close()
    br.close()
print("ALL PASSED")
