// 휴대폰 화면(320x568) 점검. 실행기: run.mjs. 인자: <서버 주소> <결과 폴더>
const { chromium } = require("playwright-core");
const fs = require("fs"), path = require("path");
const BASE = process.argv[2], OUT = process.argv[3];
const results = [];
async function check(id, fn) {
  try { const note = await fn(); results.push([id, "PASS", note || ""]); }
  catch (e) { results.push([id, "FAIL", String(e.message).split("\n")[0].slice(0, 160)]); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const pad = (n) => String(n).padStart(2, "0");
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const post = (u, b) => fetch(BASE + u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });

(async () => {
  await post("/api/transactions", { date: today, type: "income", amount: 3000000, category: "월급", memo: "월급" });
  await post("/api/transactions", { date: today, type: "expense", amount: 3000000, category: "주거", memo: null });
  for (let i = 0; i < 24; i++) await post("/api/transactions", { date: today, type: "expense", amount: 1500, category: "식비", memo: `점심${i}` });

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 320, height: 568 }, locale: "ko-KR" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(2500);
  const pageErrors = [], nativeDialogs = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
  page.on("dialog", (d) => { nativeDialogs.push(d.message()); d.dismiss(); });
  await page.goto(BASE + "/");
  await page.waitForSelector(".transaction-item");
  await page.screenshot({ path: path.join(OUT, "01-first.png") });

  const openDialog = () => page.evaluate(() => document.getElementById("transaction-dialog").open);
  const confirmOpen = () => page.evaluate(() => document.getElementById("confirm-dialog").open);
  const countIs = (n) => page.waitForFunction((k) => document.querySelectorAll(".transaction-item").length === k, n);

  await check("CMP-V1-N23 첫 화면에 거래 보임", async () => {
    const box = await page.locator(".transaction-item").first().boundingBox();
    assert(box && box.y + box.height <= 568, `첫 거래 y=${box && box.y}`);
    assert(!(await page.locator(".list-filters").isVisible()), "필터가 보임");
    assert((await page.locator(".recurring-apply").count()) === 0, "불러오기 버튼이 있음");
    const h = (await page.locator(".app-header").boundingBox()).height;
    return `헤더 ${h}px, 첫 거래 y=${box.y}`;
  });

  await check("CMP-V1-N24 금액 안 끊김", async () => {
    const r = await page.evaluate(() => {
      const lines = [...document.querySelectorAll(".summary dd")].map((dd) => {
        const range = document.createRange(); range.selectNodeContents(dd);
        const tops = new Set([...range.getClientRects()].map((x) => Math.round(x.top)));
        return { text: dd.textContent, lines: tops.size };
      });
      return { lines, sw: document.documentElement.scrollWidth };
    });
    assert(r.lines.every((l) => l.lines === 1), JSON.stringify(r.lines));
    assert(r.sw <= 320, `가로 스크롤 ${r.sw}`);
    return r.lines.map((l) => l.text).join(" / ");
  });

  await check("CMP-V1-N02 스크롤 시 요약 한 줄", async () => {
    const full = (await page.locator(".app-header").boundingBox()).height;
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(150);
    assert(await page.locator(".app-header.is-compact").count(), "is-compact 아님");
    const dl = (await page.locator(".app-header .summary").boundingBox()).height;
    const small = (await page.locator(".app-header").boundingBox()).height;
    assert(dl < 30, `요약 높이 ${dl}`);
    await page.screenshot({ path: path.join(OUT, "02-compact.png") });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);
    assert(!(await page.locator(".app-header.is-compact").count()), "되돌아오지 않음");
    return `헤더 ${full}px → ${small}px`;
  });

  await check("CMP-V1-N32 깜빡임 없음", async () => {
    const flips = await page.evaluate(async () => {
      const header = document.querySelector(".app-header");
      let n = 0;
      const mo = new MutationObserver(() => { n += 1; });
      mo.observe(header, { attributes: true, attributeFilter: ["class"] });
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let y = 0; y <= 90; y += 3) { window.scrollTo(0, y); await wait(16); }
      await wait(400);
      mo.disconnect();
      return { n, y: window.scrollY, compact: header.classList.contains("is-compact") };
    });
    assert(flips.n === 1 && flips.compact, JSON.stringify(flips));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(100);
    return JSON.stringify(flips);
  });

  await check("CMP-V1-N26 검색 접기", async () => {
    await page.locator(".filter-toggle").click();
    assert(await page.locator(".list-filters").isVisible(), "펼쳐지지 않음");
    assert((await page.locator(".filter-toggle").textContent()) === "검색 닫기", "펼침 문구");
    await page.locator(".filter-q").fill("점심1");
    await page.locator(".filter-search button").click();
    await page.waitForFunction(() => /\d+건/.test((document.querySelector(".filter-total") || {}).textContent || ""));
    await page.locator(".filter-toggle").click();
    assert(!(await page.locator(".list-filters").isVisible()), "접히지 않음");
    assert((await page.locator(".filter-toggle").textContent()) === "검색 (적용 중)", "적용 중 문구");
    const text = await page.locator(".filter-total").textContent();
    assert(await page.locator(".filter-total").isVisible(), "결과 줄 없음");
    await page.locator(".filter-toggle").click();
    assert((await page.locator(".filter-q").inputValue()) === "점심1", "검색어 유지 안 됨");
    await page.locator(".filter-reset").click();
    await page.locator(".filter-toggle").click();
    await countIs(26);
    return text;
  });

  await check("CMP-V1-N25 설정 탭 헤더", async () => {
    await page.locator(".tab-button", { hasText: "설정" }).click();
    assert(!(await page.locator(".month-controls").isVisible()), "월 이동이 보임");
    assert(!(await page.locator("#summary-panel").isVisible()), "요약이 보임");
    assert(await page.locator("h1").isVisible(), "제목 없음");
    await page.screenshot({ path: path.join(OUT, "03-settings.png") });
    await page.locator(".tab-button", { hasText: "통계" }).click();
    assert(await page.locator("#summary-panel").isVisible(), "통계 탭에서 요약 없음");
    await page.locator(".tab-button", { hasText: "내역" }).click();
    assert(await page.locator(".month-controls").isVisible(), "내역 탭에서 월 이동 없음");
  });

  await check("CMP-V1-N27 창 위 되돌리기", async () => {
    await countIs(26);
    await page.locator(".transaction-item").first().click();
    await page.locator("#transaction-dialog .delete-button").click();
    await page.locator(".confirm-ok").click();
    await countIs(25);
    await page.locator("#add-button").click();
    assert(await openDialog(), "창이 안 열림");
    await page.screenshot({ path: path.join(OUT, "04-undo-over-dialog.png") });
    await page.locator(".toast-action", { hasText: "되돌리기" }).click({ timeout: 1500 });
    await countIs(26);
    assert(await openDialog(), "입력 창이 닫힘");
    await page.locator("#transaction-dialog .cancel-button").click();
    assert(await page.evaluate(() => document.getElementById("toast-region").parentElement === document.body), "알림 영역이 body로 안 돌아옴");
  });
  // 앞 항목이 실패해도 다음 항목이 영향받지 않게 창을 닫아 둔다.
  await page.evaluate(() => { for (const d of document.querySelectorAll("dialog[open]")) d.close(); });
  await page.waitForTimeout(100);

  await check("CMP-V1-N28 Esc 바꾼 값 없음", async () => {
    await page.locator("#add-button").click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    assert(!(await openDialog()), "등록 창이 안 닫힘");
    assert(!(await confirmOpen()), "확인 창이 뜸");
    await page.locator(".transaction-item").first().click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    assert(!(await openDialog()) && !(await confirmOpen()), "수정 창 Esc");
  });
  await page.evaluate(() => { for (const d of document.querySelectorAll("dialog[open]")) d.close(); });
  await page.waitForTimeout(100);

  await check("CMP-V1-N29 Esc → 취소", async () => {
    await page.locator("#add-button").click();
    await page.locator('#transaction-dialog input[name="amount"]').fill("12345");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#confirm-dialog[open]", { timeout: 800 });
    assert((await page.locator(".confirm-message").textContent()) === "입력한 내용을 버리고 닫을까요?", "문구");
    await page.screenshot({ path: path.join(OUT, "05-esc-confirm.png") });
    await page.locator(".confirm-cancel").click();
    assert(await openDialog(), "창이 닫힘");
    assert((await page.locator('#transaction-dialog input[name="amount"]').inputValue()).replace(/,/g, "") === "12345", "입력값 사라짐");
  });

  await check("CMP-V1-N30 Esc 연속", async () => {
    await page.keyboard.press("Escape"); await page.waitForTimeout(80);
    assert(await confirmOpen(), "1번째 확인 창 없음");
    await page.keyboard.press("Escape"); await page.waitForTimeout(80);
    assert(!(await confirmOpen()) && (await openDialog()), "2번째");
    await page.keyboard.press("Escape"); await page.waitForTimeout(80);
    assert(await confirmOpen(), "3번째: 확인 없이 닫힘");
    assert(await openDialog(), "3번째: 창 닫힘");
  });

  await check("CMP-V1-N31 Esc → 버리기", async () => {
    await page.locator(".confirm-ok").click({ timeout: 800 });
    await page.waitForTimeout(80);
    assert(!(await openDialog()), "안 닫힘");
    await page.locator("#add-button").click();
    assert((await page.locator('#transaction-dialog input[name="amount"]').inputValue()) === "", "다시 열어도 값이 남음");
    await page.locator("#transaction-dialog .cancel-button").click();
  });
  await page.evaluate(() => { for (const d of document.querySelectorAll("dialog[open]")) d.close(); });
  await page.waitForTimeout(100);

  await check("CMP-V1-N12 수정 알림", async () => {
    await page.locator(".transaction-item").first().click();
    await page.locator('#transaction-dialog input[name="memo"]').fill("수정한 메모");
    await page.locator('#transaction-form button[type="submit"]').click();
    await page.waitForFunction(() => !document.getElementById("transaction-dialog").open);
    const text = await page.locator(".toast").textContent({ timeout: 800 });
    assert(text.includes("수정했습니다."), `알림: ${text}`);
    return text;
  });

  await check("CMP-V1-N20 복원 결과 알림", async () => {
    await countIs(26);
    const backup = Buffer.from(await (await fetch(BASE + "/api/backup")).arrayBuffer());
    const file = path.join(OUT, "backup.db");
    fs.writeFileSync(file, backup);
    await page.locator(".transaction-item").first().click();
    await page.locator("#transaction-dialog .delete-button").click();
    await page.locator(".confirm-ok").click();
    await countIs(25);
    await page.locator(".tab-button", { hasText: "설정" }).click();
    await page.evaluate(() => { window.__sameDocument = true; });
    await page.locator(".restore-input").setInputFiles(file);
    await page.locator(".confirm-ok").click();
    await page.waitForFunction(() => document.querySelector(".toast") && document.querySelector(".toast").textContent.includes("복원"));
    const text = await page.locator(".toast").textContent();
    assert(/거래 26건/.test(text), `건수: ${text}`);
    assert(/budget-before-restore-[\d-]+\.db/.test(text), `사본: ${text}`);
    assert(await page.evaluate(() => window.__sameDocument === true), "페이지가 새로 열림");
    await page.screenshot({ path: path.join(OUT, "06-restore.png") });
    await page.waitForTimeout(5500);
    assert(await page.locator(".toast").count(), "알림이 저절로 사라짐");
    assert(await page.locator(".backup-button").isEnabled(), "버튼 비활성 그대로");
    await page.locator(".toast-action", { hasText: "닫기" }).click();
    assert(!(await page.locator(".toast").count()), "닫기 안 됨");
    await page.locator(".tab-button", { hasText: "내역" }).click();
    await countIs(26);
    return text;
  });

  await check("CMP-V1-N22 브라우저 창·콘솔 오류 없음", async () => {
    assert(nativeDialogs.length === 0, nativeDialogs.join());
    assert(pageErrors.length === 0, pageErrors.join(" | "));
  });

  await browser.close();
  for (const [id, status, note] of results) console.log(`${status}  ${id}${note ? "  — " + note : ""}`);
  const failed = results.filter((r) => r[1] === "FAIL").length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(2); });
