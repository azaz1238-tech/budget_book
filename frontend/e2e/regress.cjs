// 전체 기능 점검. 실행기: run.mjs. 인자: <서버 주소> <결과 폴더>
// 화면 전체 회귀 점검. 항목마다 데이터를 비우고 페이지를 새로 연다.
const { chromium } = require("playwright-core");
const fs = require("fs"), path = require("path");
const BASE = process.argv[2], OUT = process.argv[3];
const results = [];
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || ""} 기대=${JSON.stringify(b)} 실제=${JSON.stringify(a)}`); }
const pad = (n) => String(n).padStart(2, "0");
const now = new Date();
const ym = { year: now.getFullYear(), month: now.getMonth() + 1 };
const shift = ({ year, month }, d) => { const i = year * 12 + month - 1 + d; return { year: Math.floor(i / 12), month: i % 12 + 1 }; };
const prev = shift(ym, -1), next = shift(ym, 1);
const today = `${ym.year}-${pad(ym.month)}-${pad(now.getDate())}`;
const yd = new Date(now); yd.setDate(yd.getDate() - 1);
const yesterday = `${yd.getFullYear()}-${pad(yd.getMonth() + 1)}-${pad(yd.getDate())}`;
const inPrev = `${prev.year}-${pad(prev.month)}-15`;
const label = ({ year, month }) => `${year}년 ${month}월`;
const json = (method, u, b) => fetch(BASE + u, { method, headers: { "Content-Type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) });
const addTx = async (t) => (await json("POST", "/api/transactions", { date: today, type: "expense", amount: 1000, category: "식비", memo: null, ...t })).json();

async function wipe() {
  for (const m of [prev, ym, next]) {
    const rows = await (await fetch(`${BASE}/api/transactions?year=${m.year}&month=${m.month}`)).json();
    for (const r of rows) await json("DELETE", `/api/transactions/${r.id}`);
  }
  for (const r of await (await fetch(`${BASE}/api/recurring`)).json()) await json("DELETE", `/api/recurring/${r.id}`);
  for (const b of await (await fetch(`${BASE}/api/budgets`)).json()) await json("DELETE", `/api/budgets/${b.category_id}`);
  const cats = await (await fetch(`${BASE}/api/categories`)).json();
  for (const c of [...cats.expense, ...cats.income]) if (!c.is_default) await json("DELETE", `/api/categories/${c.id}`);
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 }, locale: "ko-KR", acceptDownloads: true });
  const pageErrors = [], nativeDialogs = [];
  let page;

  const dlg = (s) => page.locator(`#transaction-dialog ${s}`);
  const tab = (t) => page.locator(".tab-button", { hasText: t }).click();
  const openAdd = () => page.locator("#add-button").click();
  const chip = (name) => dlg(`.chip:has(input[value="${name}"])`).click();
  const seg = (t) => dlg(`.segment:has(input[value="${t}"])`).click();
  const countIs = (n) => page.waitForFunction((k) => document.querySelectorAll(".transaction-item").length === k, n);
  const toastHas = (s) => page.waitForFunction((k) => (document.querySelector(".toast") || {}).textContent?.includes(k), s);
  const save = () => dlg('button[type="submit"]').click();
  const month = () => page.locator(".month-label").textContent();
  const openFilters = () => page.locator(".filter-toggle").click();
  const dialogOpen = () => page.evaluate(() => document.getElementById("transaction-dialog").open);

  async function check(id, fn) {
    await wipe();
    if (page) await page.close();
    page = await ctx.newPage();
    page.setDefaultTimeout(3000);
    page.on("pageerror", (e) => pageErrors.push(`${id}: ${e.message}`));
    page.on("dialog", (d) => { nativeDialogs.push(d.message()); d.dismiss(); });
    try {
      const prepare = fn.prepare;
      if (prepare) await prepare();
      await page.goto(BASE + "/");
      await page.waitForSelector(".summary dd");
      const note = await fn();
      results.push([id, "PASS", note || ""]);
    } catch (e) {
      await page.screenshot({ path: path.join(OUT, `fail-${id.split(" ")[0]}.png`) }).catch(() => {});
      results.push([id, "FAIL", String(e.message).split("\n")[0].slice(0, 200)]);
    }
  }
  const withData = (prepare, fn) => { fn.prepare = prepare; return fn; };

  await check("R01 금액 콤마와 커서", async () => {
    await openAdd();
    const a = dlg('input[name="amount"]');
    assert(await a.evaluate((n) => n === document.activeElement), "금액칸 포커스");
    await a.pressSequentially("1234567");
    eq(await a.inputValue(), "1,234,567");
    await a.fill("1234");
    await a.press("Home"); await a.press("ArrowRight"); await a.press("9");
    eq(await a.inputValue(), "19,234");
    eq(await a.evaluate((n) => n.selectionStart), 3, "커서는 오른쪽 숫자 개수 기준");
    await a.press("End"); await a.press("Backspace"); await a.press("Backspace");
    eq(await a.inputValue(), "192");
    await a.press("Home"); await a.press(",");
    eq(await a.inputValue(), "192");
    eq(await a.evaluate((n) => n.selectionStart), 0, "콤마 입력 후 커서");
    await a.fill("12a");
    eq(await a.inputValue(), "12a", "다른 글자는 그대로");
  });

  await check("R02 빠른 금액", async () => {
    await openAdd();
    await dlg(".shortcut-button:has-text('+1만')").click();
    await dlg(".shortcut-button:has-text('+5천')").click();
    eq(await dlg('input[name="amount"]').inputValue(), "15,000");
    assert(await dlg('input[name="amount"]').evaluate((n) => n === document.activeElement), "포커스");
    await dlg('input[name="amount"]').fill("abc");
    await dlg(".shortcut-button:has-text('+1천')").click();
    eq(await dlg('input[name="amount"]').inputValue(), "1,000", "잘못된 값은 0에서");
  });

  await check("R03 거래일 버튼", async () => {
    await openAdd();
    eq(await dlg('input[name="date"]').inputValue(), today);
    await dlg(".shortcut-button:has-text('어제')").click();
    eq(await dlg('input[name="date"]').inputValue(), yesterday);
    await dlg(".shortcut-button:has-text('오늘')").click();
    eq(await dlg('input[name="date"]').inputValue(), today);
  });

  await check("R04 유형 토글과 칩", async () => {
    await openAdd();
    eq(await dlg("h2").textContent(), "거래 등록");
    assert(await dlg('input[name="type"][value="expense"]').isChecked(), "기본 지출");
    await chip("식비");
    assert(await dlg('input[value="식비"]').isChecked(), "칩 선택");
    await seg("income");
    eq(await dlg('input[name="category"]').count(), 3, "수입 칩 수");
    eq(await dlg('input[name="category"]:checked').count(), 0, "선택 풀림");
    await seg("expense");
    eq(await dlg('input[name="category"]').count(), 7, "지출 칩 수");
    eq(await dlg('input[name="category"]:checked').count(), 0, "선택 풀림 2");
  });

  await check("R05 입력 검사", async () => {
    let posts = 0;
    page.on("request", (r) => { if (r.method() === "POST") posts += 1; });
    await openAdd();
    await save();
    eq(await dlg(".form-error").textContent(), "금액을 입력해 주세요.");
    await dlg('input[name="amount"]').fill("0"); await save();
    eq(await dlg(".form-error").textContent(), "금액은 1 이상의 정수여야 합니다.");
    await dlg('input[name="amount"]').fill("1.5"); await save();
    eq(await dlg(".form-error").textContent(), "금액은 1 이상의 정수여야 합니다.");
    await dlg('input[name="amount"]').fill("100"); await save();
    eq(await dlg(".form-error").textContent(), "분류를 선택해 주세요.");
    await dlg('input[name="date"]').fill(""); await save();
    eq(await dlg(".form-error").textContent(), "거래일을 입력해 주세요.");
    eq(posts, 0, "요청 없어야");
    assert(await dialogOpen(), "창 유지");
  });

  await check("R06 연속 입력", async () => {
    await openAdd();
    await seg("income");
    await dlg('input[name="date"]').fill(yesterday);
    await dlg('input[name="amount"]').fill("3000");
    await chip("용돈");
    await dlg('input[name="memo"]').fill("  메모  ");
    await save();
    await page.waitForFunction(() => document.querySelector("#transaction-dialog .form-notice")?.textContent === "저장했습니다.");
    assert(await dialogOpen(), "창 유지");
    eq(await dlg('input[name="amount"]').inputValue(), "");
    eq(await dlg('input[name="memo"]').inputValue(), "");
    eq(await dlg('input[name="category"]:checked').count(), 0);
    assert(await dlg('input[name="type"][value="income"]').isChecked(), "유형 유지");
    eq(await dlg('input[name="date"]').inputValue(), yesterday, "거래일 유지");
    assert(await dlg('input[name="amount"]').evaluate((n) => n === document.activeElement), "금액칸 포커스");
    await dlg('input[name="amount"]').fill("1"); await save();
    eq(await dlg(".form-error").textContent(), "분류를 선택해 주세요.");
    eq(Boolean(await dlg(".form-notice").count()) && await dlg(".form-notice").isVisible(), false, "알림 사라짐");
    await dlg(".cancel-button").click();
    assert(!(await dialogOpen()), "닫힘");
    const y = yd.getMonth() + 1 === ym.month ? 1 : 0;
    if (y) {
      await countIs(1);
      eq(await page.locator(".item-memo").first().textContent(), "메모", "메모 앞뒤 공백 제거");
      eq(await page.locator(".item-amount").first().textContent(), "+3,000원");
    }
    await openAdd();
    assert(await dlg('input[name="type"][value="expense"]').isChecked(), "다시 열면 기본값");
    eq(await dlg('input[name="date"]').inputValue(), today);
  });

  await check("R07 저장한 달로 이동", async () => {
    await openAdd();
    await dlg('input[name="date"]').fill(inPrev);
    await dlg('input[name="amount"]').fill("500");
    await chip("교통");
    await save();
    await page.waitForFunction((t) => document.querySelector(".month-label").textContent === t, label(prev));
    await countIs(1);
  });

  await check("R08 월 이동", async () => {
    eq(await month(), label(ym));
    eq(await page.locator(".today-button").count(), 0, "이번 달 버튼 없음");
    await page.locator('.nav-button[aria-label="이전 달"]').click();
    eq(await month(), label(prev));
    assert(await page.locator(".today-button").isVisible(), "이번 달 버튼");
    await page.locator(".today-button").click();
    eq(await month(), label(ym));
    await page.locator('.nav-button[aria-label="다음 달"]').click();
    eq(await month(), label(next));
    await page.locator(".month-label").click();
    eq(await page.locator(".month-label").getAttribute("aria-expanded"), "true");
    const input = page.locator('#month-selector input[type="month"]');
    eq(await input.inputValue(), `${next.year}-${pad(next.month)}`);
    await input.fill("2020-03");
    await page.waitForFunction(() => document.querySelector(".month-label").textContent === "2020년 3월");
    assert(!(await page.locator("#month-selector").isVisible()), "입력칸 닫힘");
    await page.locator(".month-label").click();
    await page.locator(".month-label").click();
    assert(!(await page.locator("#month-selector").isVisible()), "토글 닫힘");
  });

  await check("R09 줄 눌러 수정", withData(() => addTx({ amount: 12500, category: "교통", memo: "버스" }), async () => {
    await page.locator(".transaction-item").click();
    eq(await dlg("h2").textContent(), "거래 수정");
    eq(await dlg('input[name="amount"]').inputValue(), "12,500");
    assert(await dlg('input[value="교통"]').isChecked(), "분류");
    eq(await dlg('input[name="memo"]').inputValue(), "버스");
    eq(await dlg(".cancel-button").textContent(), "취소");
    eq(await dlg('button[type="submit"]').textContent(), "수정 저장");
    assert(await dlg(".delete-button").isVisible(), "삭제 버튼");
    await dlg(".cancel-button").click();
    assert(!(await dialogOpen()), "닫힘");
    await openAdd();
    eq(await dlg('input[name="amount"]').inputValue(), "", "등록 창은 비어 있음");
    eq(await dlg(".cancel-button").textContent(), "닫기");
    assert(!(await dlg(".delete-button").isVisible()), "등록 창에 삭제 없음");
  }));

  await check("R10 삭제·되돌리기·5초", withData(() => addTx({ amount: 12500, memo: "점심" }), async () => {
    await page.locator(".transaction-item").click();
    await dlg(".delete-button").click();
    eq(await page.locator(".confirm-message").textContent(), `${today} 식비 12,500원 내역을 삭제할까요?`);
    await page.locator(".confirm-cancel").click();
    assert(await dialogOpen(), "수정 창 유지");
    await dlg(".delete-button").click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(80);
    assert(await dialogOpen(), "Esc는 취소");
    await dlg(".delete-button").click();
    await page.locator(".confirm-ok").click();
    await countIs(0);
    assert(!(await dialogOpen()), "창 닫힘");
    await toastHas("삭제했습니다.");
    await page.locator(".toast-action", { hasText: "되돌리기" }).click();
    await countIs(1);
    await toastHas("되돌렸습니다.");
    await page.locator(".transaction-item").click();
    await dlg(".delete-button").click();
    await page.locator(".confirm-ok").click();
    await toastHas("삭제했습니다.");
    await page.waitForTimeout(5300);
    eq(await page.locator(".toast").count(), 0, "5초 뒤 사라짐");
    await countIs(0);
  }));

  await check("R11 필터", withData(async () => {
    await addTx({ amount: 1000, category: "식비", memo: "점심" });
    await addTx({ amount: 2000, category: "기타", memo: "우산" });
    await addTx({ amount: 5000, type: "income", category: "기타", memo: "점심값 환불" });
  }, async () => {
    await countIs(3);
    await openFilters();
    assert(await page.locator(".filter-reset").isDisabled(), "초기화 비활성");
    eq(await page.locator(".filter-select optgroup").count(), 2, "묶음 2개");
    await page.locator(".filter-type").selectOption("income");
    await countIs(1);
    eq(await page.locator(".filter-select option").count(), 4, "수입 분류+전체");
    await page.waitForFunction(() => /1건/.test(document.querySelector(".filter-total")?.textContent || ""));
    eq(await page.locator(".filter-total").textContent(), "검색 결과 · 1건 · 수입 5,000원");
    await page.locator(".filter-type").selectOption("");
    await countIs(3);
    await page.locator(".filter-select").selectOption("expense:기타");
    await countIs(1);
    eq(await page.locator(".filter-type").inputValue(), "expense", "유형이 맞춰짐");
    await page.locator(".filter-select").selectOption("");
    await countIs(2);
    await page.locator(".filter-type").selectOption("income");
    await countIs(1);
    eq(await page.locator(".filter-select").inputValue(), "", "유형 바뀌면 분류 해제");
    await page.locator(".filter-reset").click();
    await countIs(3);
    await page.locator(".filter-q").fill("  점심 ");
    await page.locator(".filter-q").press("Enter");
    await countIs(2);
    await page.waitForFunction(() => /2건/.test(document.querySelector(".filter-total")?.textContent || ""));
    eq(await page.locator(".filter-total").textContent(), "검색 결과 · 2건 · 수입 5,000원 · 지출 1,000원");
    await page.locator(".filter-q").fill("없는말");
    await page.locator(".filter-search button").click();
    await page.waitForSelector("text=조건에 맞는 거래가 없습니다.");
    await page.locator(".filter-q").fill("가".repeat(51));
    await page.locator(".filter-search button").click();
    eq(await page.locator(".filter-error").textContent(), "검색어는 50자 이하여야 합니다.");
    await page.locator(".filter-reset").click();
    await countIs(3);
    eq(await page.locator(".filter-q").inputValue(), "", "초기화하면 검색어도 비움");
    eq(await page.locator(".filter-error").count(), 0, "에러 사라짐");
    eq(await page.locator(".filter-total").count(), 0, "결과 줄 사라짐");
  }));

  await check("R12 필터 월 이동 유지와 검색어 유지", withData(() => addTx({ memo: "점심" }), async () => {
    await openFilters();
    await page.locator(".filter-type").selectOption("expense");
    await page.locator(".filter-q").fill("입력중");
    await page.locator('.nav-button[aria-label="이전 달"]').click();
    await page.waitForSelector("text=조건에 맞는 거래가 없습니다.");
    eq(await page.locator(".filter-type").inputValue(), "expense", "월 이동 후 유지");
    eq(await page.locator(".filter-q").inputValue(), "입력중", "입력 중 검색어 유지");
    await tab("설정"); await tab("내역");
    eq(await page.locator(".filter-q").inputValue(), "입력중", "탭 이동 후 유지");
  }));

  await check("R13 분류 추가·수정·삭제", withData(() => addTx({ category: "주거" }), async () => {
    await tab("설정");
    assert(!(await page.locator("#add-button").isVisible()), "설정 탭에 추가 버튼 없음");
    const name = page.locator(".category-add input[name=name]");
    await page.locator(".category-add button").click();
    eq(await page.locator("#category-manager > .form-error").textContent(), "분류 이름을 입력해 주세요.");
    await name.fill("가".repeat(21));
    await page.locator(".category-add button").click();
    eq(await page.locator("#category-manager > .form-error").textContent(), "분류 이름은 20자 이하여야 합니다.");
    await name.fill("식비");
    await page.locator(".category-add button").click();
    await page.waitForFunction(() => document.querySelector("#category-manager > .form-error")?.textContent.includes("이미"));
    eq(await name.inputValue(), "식비", "실패하면 입력값 유지");
    await tab("내역"); await tab("설정");
    eq(await name.inputValue(), "식비", "탭 이동 후 유지");
    await name.fill(" 간식 ");
    await page.locator('.category-add input[value="income"]').check();
    await page.locator('.category-add input[value="expense"]').check();
    await page.locator(".category-add button").click();
    await page.waitForSelector(".category-name:text-is('간식')");
    eq(await name.inputValue(), "", "성공하면 비움");
    eq(await page.locator("#category-manager > .form-error").count(), 0);
    const row = page.locator(".category-item", { has: page.locator(".category-name:text-is('간식')") });
    await row.locator("button:text-is('수정')").click();
    eq(await page.locator(".rename-input").inputValue(), "간식");
    await page.locator(".rename-input").fill("과자");
    await page.locator(".is-renaming button:text-is('취소')").click();
    await page.waitForSelector(".category-name:text-is('간식')");
    await row.locator("button:text-is('수정')").click();
    await page.locator(".rename-input").fill("과자");
    await page.locator(".is-renaming button[type=submit]").click();
    await page.waitForSelector(".category-name:text-is('과자')");
    const row2 = page.locator(".category-item", { has: page.locator(".category-name:text-is('과자')") });
    await row2.locator("button:text-is('삭제')").click();
    eq(await page.locator(".confirm-message").textContent(), "'과자'(지출) 분류를 삭제할까요?");
    await page.locator(".confirm-cancel").click();
    await row2.locator("button:text-is('삭제')").click();
    await page.locator(".confirm-ok").click();
    await page.waitForFunction(() => ![...document.querySelectorAll(".category-name")].some((n) => n.textContent === "과자"));
    const fixed = page.locator(".category-item", { has: page.locator(".category-name:text-is('주거')") });
    eq(await fixed.locator(".badge").textContent(), "기본");
    eq(await fixed.locator("button:text-is('삭제')").count(), 0, "기본 분류는 삭제 없음");
  }));

  await check("R14 분류 이름 수정·삭제와 필터", withData(async () => {
    const c = await (await json("POST", "/api/categories", { type: "expense", name: "옛이름" })).json();
    await addTx({ category: "옛이름", amount: 700 });
    await json("POST", "/api/categories", { type: "expense", name: "빈분류" });
    return c;
  }, async () => {
    await countIs(1);
    await openFilters();
    await page.locator(".filter-select").selectOption("expense:옛이름");
    await page.waitForFunction(() => /1건/.test(document.querySelector(".filter-total")?.textContent || ""));
    await tab("설정");
    const row = page.locator(".category-item", { has: page.locator(".category-name:text-is('옛이름')") });
    await row.locator("button:text-is('수정')").click();
    await page.locator(".rename-input").fill("새이름");
    await page.locator(".is-renaming button[type=submit]").click();
    await page.waitForSelector(".category-name:text-is('새이름')");
    await tab("내역");
    await countIs(1);
    eq(await page.locator(".filter-select").inputValue(), "expense:새이름", "필터가 새 이름을 따름");
    eq(await page.locator(".item-category").first().textContent(), "새이름");
    await page.locator(".filter-select").selectOption("expense:빈분류");
    await countIs(0);
    await tab("설정");
    const empty = page.locator(".category-item", { has: page.locator(".category-name:text-is('빈분류')") });
    await empty.locator("button:text-is('삭제')").click();
    await page.locator(".confirm-ok").click();
    await page.waitForFunction(() => ![...document.querySelectorAll(".category-name")].some((n) => n.textContent === "빈분류"));
    await tab("내역");
    await countIs(1);
    eq(await page.locator(".filter-select").inputValue(), "", "삭제되면 분류 해제");
    eq(await page.locator(".filter-type").inputValue(), "", "유형도 해제");
    const used = "새이름";
    await tab("설정");
    await page.locator(".category-item", { has: page.locator(`.category-name:text-is('${used}')`) }).locator("button:text-is('삭제')").click();
    await page.locator(".confirm-ok").click();
    await page.waitForFunction(() => /삭제할 수 없습니다/.test(document.querySelector("#category-manager > .form-error")?.textContent || ""));
  }));

  await check("R15 예산과 통계", withData(async () => {
    await addTx({ category: "식비", amount: 7900 });
    await addTx({ category: "교통", amount: 8000 });
    await addTx({ category: "쇼핑", amount: 10100 });
    await addTx({ category: "의료", amount: 500 });
    await addTx({ type: "income", category: "월급", amount: 99 });
  }, async () => {
    await tab("설정");
    for (const [name, amount] of [["식비", "10000"], ["교통", "10000"], ["쇼핑", "10000"]]) {
      await page.locator(".category-item", { has: page.locator(`.category-name:text-is('${name}')`) }).locator("button:text-is('예산')").click();
      await page.locator(".budget-input").fill(amount);
      eq(await page.locator(".budget-input").inputValue(), "10,000", "콤마");
      await page.locator(".is-budgeting button[type=submit]").click();
      await page.waitForSelector(`.category-item:has(.category-name:text-is('${name}')) .budget-label`);
    }
    eq(await page.locator(".category-item:has(.category-name:text-is('식비')) .budget-label").textContent(), "예산 10,000원");
    await page.locator(".category-item", { has: page.locator(".category-name:text-is('의료')") }).locator("button:text-is('예산')").click();
    await page.locator(".budget-input").fill("0");
    await page.locator(".is-budgeting button[type=submit]").click();
    eq(await page.locator("#category-manager > .form-error").textContent(), "금액은 1 이상의 정수여야 합니다.");
    await page.locator(".is-budgeting button:text-is('취소')").click();
    eq(await page.locator("#category-manager > .form-error").count(), 0);
    await tab("통계");
    await page.waitForSelector(".spending-item");
    eq(await page.locator(".spending-item").count(), 4, "수입 제외");
    eq(await page.locator(".spending-name").first().textContent(), "쇼핑", "큰 순서");
    const item = (n) => page.locator(".spending-item", { has: page.locator(`.spending-name:text-is('${n}')`) });
    assert(await item("쇼핑").locator(".spending-fill.is-over").count(), "초과 빨강");
    assert(await item("교통").locator(".spending-fill.is-warn").count(), "80% 노랑");
    eq(await item("식비").locator(".spending-fill.is-warn").count(), 0, "79%는 기본");
    eq(await item("쇼핑").locator(".spending-budget").textContent(), "예산 10,000원 · 101% 사용 · 100원 초과");
    eq(await item("교통").locator(".spending-budget").textContent(), "예산 10,000원 · 80% 사용 · 2,000원 남음");
    eq(await item("의료").locator(".spending-budget").count(), 0, "예산 없음");
    eq(await item("의료").locator(".spending-meta").textContent(), "1건 · 2%");
    await item("교통").locator("button").click();
    await countIs(1);
    assert(await page.locator("#panel-list").isVisible(), "내역 탭");
    await page.waitForFunction(() => /1건/.test(document.querySelector(".filter-total")?.textContent || ""));
    eq(await page.locator(".filter-total").textContent(), "검색 결과 · 1건 · 지출 8,000원");
    eq(await page.locator(".filter-toggle").textContent(), "검색 (적용 중)");
    await tab("설정");
    await page.locator(".category-item", { has: page.locator(".category-name:text-is('식비')") }).locator("button:text-is('예산')").click();
    await page.locator(".is-budgeting button:text-is('해제')").click();
    await page.waitForFunction(() => !document.querySelector(".is-budgeting"));
    eq(await page.locator(".category-item:has(.category-name:text-is('식비')) .budget-label").count(), 0, "해제됨");
  }));

  await check("R16 고정 거래", async () => {
    eq(await page.locator(".recurring-apply").count(), 0, "없으면 숨김");
    await tab("설정");
    await page.waitForSelector("text=등록된 고정 거래가 없습니다.");
    eq(await page.locator(".recurring-form").isVisible().catch(() => false), false, "폼 접힘");
    await page.locator(".recurring-add-button").click();
    const f = page.locator(".recurring-form");
    eq(await f.locator(".recurring-form-title").textContent(), "고정 거래 추가");
    await f.locator('button[type="submit"]').click();
    eq(await page.locator("#recurring-manager > .form-error").textContent(), "날을 입력해 주세요.");
    await f.locator('input[name="day"]').fill("32");
    await f.locator('button[type="submit"]').click();
    eq(await page.locator("#recurring-manager > .form-error").textContent(), "날은 1부터 31 사이여야 합니다.");
    await f.locator('input[name="day"]').fill("31");
    await f.locator('input[name="amount"]').fill("550000");
    eq(await f.locator('input[name="amount"]').inputValue(), "550,000");
    await f.locator('button[type="submit"]').click();
    eq(await page.locator("#recurring-manager > .form-error").textContent(), "분류를 선택해 주세요.");
    await tab("내역"); await tab("설정");
    eq(await f.locator('input[name="day"]').inputValue(), "31", "탭 이동 후 유지");
    await f.locator('select[name="category_id"]').selectOption({ label: "주거" });
    await f.locator('input[value="income"]').check();
    eq(await f.locator('select[name="category_id"]').inputValue(), "", "유형 바꾸면 분류 해제");
    await f.locator('input[value="expense"]').check();
    await f.locator('select[name="category_id"]').selectOption({ label: "주거" });
    await f.locator('input[name="memo"]').fill("월세");
    await f.locator('button[type="submit"]').click();
    await page.waitForSelector(".recurring-item");
    eq(await page.locator(".recurring-form").isVisible().catch(() => false), false, "저장하면 접힘");
    eq(await page.locator(".recurring-text").textContent(), "매달 31일 · 지출 · 주거 · 550,000원 · 월세");
    eq(await page.locator(".recurring-item .badge").textContent(), "없는 달은 말일");
    await page.locator(".recurring-item button:text-is('수정')").click();
    eq(await f.locator(".recurring-form-title").textContent(), "고정 거래 수정");
    eq(await f.locator('input[name="amount"]').inputValue(), "550,000");
    eq(await f.locator('input[name="day"]').inputValue(), "31");
    assert(await page.locator(".recurring-item.is-editing").count(), "강조");
    eq(await f.locator('select[name="category_id"] option:checked').textContent(), "주거");
    await f.locator(".cancel-button").click();
    eq(await page.locator(".recurring-item.is-editing").count(), 0);
    await page.locator(".recurring-item button:text-is('수정')").click();
    await f.locator('input[name="day"]').fill("1");
    await f.locator('button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector(".recurring-text")?.textContent.startsWith("매달 1일"));
    await page.locator(".recurring-add-button").waitFor();
    await tab("내역");
    await page.waitForSelector(".recurring-apply");
    eq(await page.locator(".recurring-apply").textContent(), "이번 달 고정 거래 불러오기 (1건)");
    await page.locator(".recurring-apply").click();
    eq(await page.locator(".confirm-message").textContent(), `${ym.year}년 ${ym.month}월에 고정 거래 1건을 추가할까요?`);
    await page.locator(".confirm-cancel").click();
    await countIs(0);
    await page.locator(".recurring-apply").click();
    await page.locator(".confirm-ok").click();
    await countIs(1);
    await page.waitForFunction(() => document.querySelector(".recurring-apply")?.textContent === "고정 거래를 모두 불러왔습니다");
    assert(await page.locator(".recurring-apply").isDisabled(), "비활성");
    await page.locator('.nav-button[aria-label="다음 달"]').click();
    await page.waitForFunction(() => document.querySelector(".recurring-apply")?.textContent.endsWith("(1건)"));
    await tab("설정");
    await page.locator(".category-item", { has: page.locator(".category-name:text-is('주거')") }).waitFor();
    await page.locator(".recurring-item button:text-is('삭제')").click();
    eq(await page.locator(".confirm-message").textContent(), "매달 1일 주거 550,000원 고정 거래를 삭제할까요? (이미 추가된 거래는 남습니다)");
    await page.locator(".confirm-ok").click();
    await page.waitForSelector("text=등록된 고정 거래가 없습니다.");
  });

  await check("R17 백업·CSV 다운로드", async () => {
    await tab("설정");
    const [d1] = await Promise.all([page.waitForEvent("download"), page.locator(".backup-button").click()]);
    assert(/^budget-backup-\d{4}-\d{2}-\d{2}-\d{4}\.db$/.test(d1.suggestedFilename()), d1.suggestedFilename());
    const [d2] = await Promise.all([page.waitForEvent("download"), page.locator(".csv-button").click()]);
    assert(/^budget-transactions-\d{4}-\d{2}-\d{2}-\d{4}\.csv$/.test(d2.suggestedFilename()), d2.suggestedFilename());
    await page.waitForFunction(() => !document.querySelector(".backup-button").disabled);
  });

  await check("R18 잘못된 복원 파일·같은 파일 다시 선택", withData(() => addTx({}), async () => {
    const bad = path.join(OUT, "not-a-backup.db");
    fs.writeFileSync(bad, "이건 백업이 아닙니다");
    await tab("설정");
    await page.locator(".restore-input").setInputFiles(bad);
    await page.locator(".confirm-cancel").click();
    await page.locator(".restore-input").setInputFiles(bad);
    assert((await page.locator(".confirm-message").textContent()).includes("not-a-backup.db"), "같은 파일 다시 선택");
    await page.locator(".confirm-ok").click();
    await page.waitForSelector(".toast-error");
    await page.waitForTimeout(4300);
    assert(await page.locator(".toast-error").count(), "에러 알림 유지");
    await page.locator(".toast-action", { hasText: "닫기" }).click();
    eq(await page.locator(".toast").count(), 0);
    assert(await page.locator(".restore-button").isEnabled(), "버튼 복구");
    await tab("내역");
    await countIs(1);
  }));

  await check("R19 복원 후 상태 비움", withData(() => addTx({ memo: "백업전" }), async () => {
    await countIs(1);
    const file = path.join(OUT, "r19.db");
    fs.writeFileSync(file, Buffer.from(await (await fetch(BASE + "/api/backup")).arrayBuffer()));
    await addTx({ memo: "백업후" });
    await page.locator('.nav-button[aria-label="이전 달"]').click();
    await page.locator('.nav-button[aria-label="다음 달"]').click();
    await countIs(2);
    await openFilters();
    await page.locator(".filter-q").fill("백업");
    await page.locator(".filter-q").press("Enter");
    await tab("설정");
    await page.locator(".recurring-add-button").click();
    await page.locator(".restore-input").setInputFiles(file);
    await page.locator(".confirm-ok").click();
    await toastHas("거래 1건");
    eq(await page.locator(".recurring-form").isVisible().catch(() => false), false, "폼 닫힘");
    await tab("내역");
    await countIs(1);
    eq(await page.locator(".filter-toggle").textContent(), "검색", "필터 해제");
    eq(await page.locator(".filter-q").inputValue(), "", "검색어 비움");
  }));

  await check("R20 빈 달과 통계 빈 화면", async () => {
    await page.waitForSelector(`text=${label(ym)}에는 거래 내역이 없습니다. 첫 거래를 기록해 보세요.`);
    await page.locator(".status-empty button").click();
    assert(await dialogOpen(), "추가 버튼이 창을 염");
    await dlg(".cancel-button").click();
    await tab("통계");
    await page.waitForSelector(`text=${label(ym)}에는 지출이 없습니다.`);
  });

  await check("R21 날짜 묶음과 부호", withData(async () => {
    await addTx({ amount: 1000, category: "식비" });
    await addTx({ amount: 2000, category: "교통" });
    await addTx({ amount: 5000, type: "income", category: "월급" });
    await addTx({ amount: 300, date: `${prev.year}-${pad(prev.month)}-02` });
  }, async () => {
    await countIs(3);
    eq(await page.locator(".date-group").count(), 1);
    const d = new Date(today + "T00:00:00");
    const wd = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
    eq(await page.locator(".date-heading").textContent(), `${ym.month}월 ${now.getDate()}일 (${wd}) · 지출 3,000원 · 수입 5,000원`);
    eq(await page.locator(".item-amount").first().textContent(), "+5,000원", "최신 먼저");
    eq(await page.locator(".item-amount").nth(1).textContent(), "−2,000원", "U+2212");
    const dd = await page.locator(".summary dd").allTextContents();
    eq(dd.join("/"), "5,000원/3,000원/2,000원");
    await page.locator('.nav-button[aria-label="이전 달"]').click();
    await countIs(1);
    await page.waitForFunction(() => document.querySelector(".summary dd")?.textContent === "0원");
  }));

  await check("R22 연결 실패와 다시 시도", withData(() => addTx({}), async () => {
    await countIs(1);
    await page.route("**/api/transactions", (r) => r.abort());
    await openAdd();
    await dlg('input[name="amount"]').fill("777");
    await chip("식비");
    await save();
    await page.waitForFunction(() => document.querySelector("#transaction-dialog .form-error")?.textContent === "서버에 연결할 수 없습니다.");
    assert(await dialogOpen(), "창 유지");
    eq(await dlg('input[name="amount"]').inputValue(), "777", "입력값 유지");
    assert(await dlg('button[type="submit"]').isEnabled(), "저장 버튼 복구");
    await page.unroute("**/api/transactions");
    await dlg(".cancel-button").click();
    await page.route("**/api/transactions?*", (r) => r.abort());
    await page.locator('.nav-button[aria-label="이전 달"]').click();
    await page.waitForSelector("#transaction-list .status-error");
    await page.unroute("**/api/transactions?*");
    await page.locator('.nav-button[aria-label="다음 달"]').click();
    await countIs(1);
    await page.route("**/api/transactions?*", (r) => r.abort());
    await page.locator('.nav-button[aria-label="이전 달"]').click();
    await page.waitForSelector("#transaction-list .status-error");
    await page.unroute("**/api/transactions?*");
    await page.locator("#transaction-list .status-error button").click();
    await page.waitForSelector("#transaction-list .status-empty");
    await page.route("**/api/transactions/*", (r) => r.abort());
    await page.locator('.nav-button[aria-label="다음 달"]').click();
    await countIs(1);
    await page.locator(".transaction-item").click();
    await dlg(".delete-button").click();
    await page.locator(".confirm-ok").click();
    await page.waitForFunction(() => document.querySelector("#transaction-dialog .form-error")?.textContent === "서버에 연결할 수 없습니다.");
    assert(await dialogOpen(), "삭제 실패 시 창 유지");
  }));

  await check("R23 늦은 응답이 최신을 덮지 않음", withData(() => addTx({ memo: "이번달" }), async () => {
    await countIs(1);
    await page.route(`**/api/transactions?year=${prev.year}&month=${prev.month}*`, async (r) => {
      await new Promise((res) => setTimeout(res, 700));
      await r.fulfill({ json: [{ id: 999, date: inPrev, type: "expense", amount: 1, category: "식비", memo: "늦은응답", created_at: "2026-01-01T00:00:00" }] });
    });
    await page.locator('.nav-button[aria-label="이전 달"]').click();
    await page.locator('.nav-button[aria-label="다음 달"]').click();
    await countIs(1);
    await page.waitForTimeout(900);
    await countIs(1);
    eq(await page.locator(".item-memo").first().textContent(), "이번달");
  }));

  await check("R24 수정 저장 다른 달로 이동·없어진 거래", withData(() => addTx({ amount: 100 }), async () => {
    await countIs(1);
    await page.locator(".transaction-item").click();
    await dlg('input[name="date"]').fill(inPrev);
    await save();
    await page.waitForFunction((t) => document.querySelector(".month-label").textContent === t, label(prev));
    await countIs(1);
    await toastHas("수정했습니다.");
    const [row] = await (await fetch(`${BASE}/api/transactions?year=${prev.year}&month=${prev.month}`)).json();
    await page.locator(".transaction-item").click();
    await json("DELETE", `/api/transactions/${row.id}`);
    await dlg('input[name="memo"]').fill("없어진 거래");
    await save();
    await page.waitForSelector("#transaction-dialog .form-error");
    await countIs(0);
    assert(await dialogOpen(), "창 유지");
  }));

  await check("R25 키보드: 칩과 토글, 검색 버튼 포커스", async () => {
    await openFilters();
    assert(await page.locator(".filter-toggle").evaluate((n) => n === document.activeElement), "포커스 유지");
    eq(await page.locator(".filter-toggle").getAttribute("aria-expanded"), "true");
    await page.locator(".filter-toggle").click();
    eq(await page.locator(".filter-toggle").getAttribute("aria-expanded"), "false");
    await tab("통계");
    eq(await page.locator('.tab-button[aria-selected="true"]').textContent(), "통계");
    assert(await page.locator("#add-button").isVisible(), "통계 탭에 추가 버튼");
    await openAdd();
    await dlg('input[name="amount"]').fill("5");
    await dlg('input[name="memo"]').press("Enter");
    eq(await dlg(".form-error").textContent(), "분류를 선택해 주세요.", "Enter로 제출");
  });

  await check("R26 수정 창 바꾼 값 되돌리면 확인 없이 닫힘", withData(() => addTx({ amount: 12500, category: "교통", memo: "버스" }), async () => {
    await page.locator(".transaction-item").click();
    await dlg('input[name="amount"]').fill("12500");
    await dlg('input[name="memo"]').fill(" 버스 ");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(80);
    assert(!(await page.evaluate(() => document.getElementById("confirm-dialog").open)), "같은 값이면 확인 없음");
    assert(!(await dialogOpen()), "닫힘");
    await page.locator(".transaction-item").click();
    await chip("식비");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#confirm-dialog[open]");
    await page.locator(".confirm-cancel").click();
    assert(await dlg('input[value="식비"]').isChecked(), "선택 유지");
  }));

  await browser.close();
  for (const [id, status, note] of results) console.log(`${status}  ${id}${note ? "  — " + note : ""}`);
  console.log("native dialogs:", nativeDialogs.length, " page errors:", pageErrors.length ? pageErrors.join(" | ") : 0);
  const failed = results.filter((r) => r[1] === "FAIL").length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exitCode = failed || pageErrors.length || nativeDialogs.length ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(2); });
