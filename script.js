// ▼ Apps Script 웹 앱 배포 후 받은 주소(.../exec)를 여기에 붙여 넣으세요.
const API_URL = "https://script.google.com/macros/s/AKfycbwMbzaPHPXxxLx_-z4s5ExttCM2ooFd7Y-1Qa-bC6XsM3f19lGU9O23TukZ8i20u8NRDg/exec";

(function () {
  const COUNT = 15;
  const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
  const REFRESH_MS = 15 * 1000; // 다른 선생님의 변경 사항을 가져오는 주기

  let laptops = {};        // 번호 -> { status, teacher, due }
  let loaded = false;
  let busyOp = false;
  let lastJson = "";

  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, "0");

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function addDays(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function fmtDue(s) {
    if (!s) return "";
    const [y, m, d] = s.split("-").map(Number);
    if (!y || !m || !d) return s;
    const w = WEEK[new Date(y, m - 1, d).getDay()];
    return m + "월 " + d + "일(" + w + ")";
  }
  function fmtAt(s) {
    // 시트에는 "2026-09-28 14:05" 형식으로 저장됩니다.
    return String(s || "").replace(/-/g, ".");
  }
  function isLate(l) { return l && l.status === "rented" && l.due && l.due < todayStr(); }

  function showToast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { t.hidden = true; }, 2600);
  }
  function showNotice(msg) {
    const n = $("notice");
    n.textContent = msg;
    n.hidden = !msg;
  }

  // ---------- 현황판 ----------
  function renderBoard() {
    const d = new Date();
    $("today").textContent = "오늘 " + d.getFullYear() + "년 " + (d.getMonth() + 1) + "월 " + d.getDate() + "일(" + WEEK[d.getDay()] + ")";

    const board = $("board");
    board.textContent = "";
    let ok = 0, busy = 0, late = 0;
    for (let n = 1; n <= COUNT; n++) {
      const l = laptops[n];
      const rented = l && l.status === "rented";
      const lt = isLate(l);
      if (loaded) { rented ? busy++ : ok++; if (lt) late++; }

      const b = document.createElement("button");
      b.type = "button";
      b.className = "card " + (!loaded ? "loading" : rented ? "busy" + (lt ? " late" : "") : "ok");
      b.disabled = !loaded;

      const no = document.createElement("span");
      no.className = "no";
      const nb = document.createElement("b");
      nb.textContent = pad(n);
      no.append("노트북", nb);

      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = !loaded ? "확인 중" : rented ? "대여 중" : "대여 가능";
      b.append(no, pill);

      if (loaded && rented) {
        const who = document.createElement("span");
        who.className = "who";
        who.textContent = (l.teacher || "") + " 선생님";
        const due = document.createElement("span");
        due.className = "due";
        due.textContent = (lt ? "반납 지연 · " : "반납 예정 ") + fmtDue(l.due);
        b.append(who, due);
      }
      if (loaded) {
        const act = document.createElement("span");
        act.className = "act";
        act.textContent = rented ? "반납하기 →" : "대여하기 →";
        b.append(act);
      }
      b.setAttribute("aria-label", "노트북 " + n + "번, " + pill.textContent + (rented ? ", " + l.teacher + " 선생님, 반납 예정 " + fmtDue(l.due) : ""));
      b.addEventListener("click", () => { rented ? openReturn(n) : openRent(n); });
      board.append(b);
    }
    const unit = "<small>대</small>";
    $("s-ok").innerHTML = (loaded ? ok : "–") + unit;
    $("s-busy").innerHTML = (loaded ? busy : "–") + unit;
    $("s-late").innerHTML = (loaded ? late : "–") + unit;
  }

  // ---------- 기록 ----------
  function renderLog(docs) {
    const log = $("log");
    log.querySelectorAll(".log-row:not(.head), .empty").forEach((el) => el.remove());
    if (!docs.length) {
      const e = document.createElement("div");
      e.className = "empty";
      e.textContent = "아직 기록이 없습니다.";
      log.append(e);
      return;
    }
    for (const r of docs) {
      const row = document.createElement("div");
      row.className = "log-row";
      const t = document.createElement("span"); t.className = "t"; t.textContent = fmtAt(r.at);
      const d = document.createElement("span"); d.className = "d"; d.textContent = pad(r.device) + "번";
      const nm = document.createElement("span"); nm.className = "n"; nm.textContent = (r.teacher || "") + " 선생님";
      const tag = document.createElement("span");
      tag.className = "tag " + (r.type === "rent" ? "rent" : "return");
      tag.textContent = r.type === "rent" ? "대여" : "반납";
      row.append(t, d, nm, tag);
      log.append(row);
    }
  }

  // ---------- 대화상자 ----------
  let lastFocus = null;
  function openModal(build) {
    lastFocus = document.activeElement;
    const m = $("modal");
    m.textContent = "";
    build(m);
    $("overlay").hidden = false;
    const f = m.querySelector("input, .btn.primary");
    if (f) f.focus();
  }
  function closeModal() {
    if (busyOp) return;
    $("overlay").hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $("overlay").addEventListener("click", (e) => { if (e.target.id === "overlay") closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("overlay").hidden) closeModal(); });

  function el(tag, props, ...kids) {
    const e = document.createElement(tag);
    Object.assign(e, props || {});
    e.append(...kids);
    return e;
  }

  function openRent(n) {
    openModal((m) => {
      const title = el("h3", { id: "m-title", textContent: "노트북 " + pad(n) + "번 대여" });
      const form = el("form", { noValidate: true });
      form.style.cssText = "display:flex;flex-direction:column;gap:16px";

      const nameIn = el("input", { id: "f-name", type: "text", maxLength: 20, autocomplete: "off", placeholder: "예: 김민정" });
      const nameField = el("div", { className: "field" },
        el("label", { htmlFor: "f-name", textContent: "교사 이름" }),
        nameIn,
        el("span", { className: "sub", textContent: "이름만 적어 주세요. 연락처는 받지 않습니다." }));

      const dueIn = el("input", { id: "f-due", type: "date", min: todayStr(), value: addDays(1) });
      const quick = el("div", { className: "quick" });
      [["오늘", 0], ["내일", 1], ["3일 후", 3], ["1주 후", 7]].forEach(([label, d]) => {
        const q = el("button", { type: "button", textContent: label });
        q.addEventListener("click", () => { dueIn.value = addDays(d); });
        quick.append(q);
      });
      const dueField = el("div", { className: "field" },
        el("label", { htmlFor: "f-due", textContent: "반납 예정일" }), dueIn, quick);

      const err = el("p", { className: "err", hidden: true });
      const cancel = el("button", { type: "button", className: "btn", textContent: "취소" });
      const ok = el("button", { type: "submit", className: "btn primary", textContent: "대여하기" });
      cancel.addEventListener("click", closeModal);

      form.append(nameField, dueField, err, el("div", { className: "btns" }, cancel, ok));
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = nameIn.value.trim().replace(/\s+/g, " ");
        const due = dueIn.value;
        err.hidden = true;
        if (!name) { err.textContent = "교사 이름을 입력해 주세요."; err.hidden = false; nameIn.focus(); return; }
        if (!due) { err.textContent = "반납 예정일을 선택해 주세요."; err.hidden = false; dueIn.focus(); return; }
        if (due < todayStr()) { err.textContent = "반납 예정일은 오늘 이후로 선택해 주세요."; err.hidden = false; dueIn.focus(); return; }
        ok.disabled = cancel.disabled = true;
        ok.textContent = "저장 중…";
        busyOp = true;
        try {
          await send({ action: "rent", device: n, teacher: name, due: due });
          busyOp = false;
          closeModal();
          showToast("노트북 " + pad(n) + "번을 대여했습니다. 반납일: " + fmtDue(due));
        } catch (x) {
          busyOp = false;
          err.textContent = errorText(x);
          err.hidden = false;
          ok.disabled = cancel.disabled = false;
          ok.textContent = "대여하기";
        }
      });
      m.append(title, form);
    });
  }

  function openReturn(n) {
    const l = laptops[n] || {};
    openModal((m) => {
      const title = el("h3", { id: "m-title", textContent: "노트북 " + pad(n) + "번 반납" });
      const p = el("p", { textContent: "노트북과 충전기를 제자리에 두셨나요? 확인을 누르면 대여 가능 상태로 바뀝니다." });
      const dl = el("dl", { className: "summary-box" },
        el("dt", { textContent: "대여자" }), el("dd", { textContent: (l.teacher || "") + " 선생님" }),
        el("dt", { textContent: "반납 예정" }), el("dd", { textContent: fmtDue(l.due) + (isLate(l) ? " (지연)" : "") }));
      const err = el("p", { className: "err", hidden: true });
      const cancel = el("button", { type: "button", className: "btn", textContent: "취소" });
      const ok = el("button", { type: "button", className: "btn primary", textContent: "반납 확인" });
      cancel.addEventListener("click", closeModal);
      ok.addEventListener("click", async () => {
        ok.disabled = cancel.disabled = true;
        ok.textContent = "저장 중…";
        busyOp = true;
        try {
          await send({ action: "return", device: n });
          busyOp = false;
          closeModal();
          showToast("노트북 " + pad(n) + "번을 반납했습니다.");
        } catch (x) {
          busyOp = false;
          err.textContent = errorText(x);
          err.hidden = false;
          ok.disabled = cancel.disabled = false;
          ok.textContent = "반납 확인";
        }
      });
      m.append(title, p, dl, err, el("div", { className: "btns" }, cancel, ok));
    });
  }

  function errorText(x) {
    const code = x && x.code;
    if (code === "taken") return "방금 다른 선생님이 이 노트북을 대여했습니다. 다른 노트북을 선택해 주세요.";
    if (code === "already_returned") return "이미 반납된 노트북입니다.";
    if (code === "busy") return "다른 분이 동시에 저장하고 있습니다. 잠시 후 다시 눌러 주세요.";
    if (code === "bad_name") return "교사 이름은 1~20자로 입력해 주세요.";
    if (code === "bad_date") return "반납 예정일은 오늘 이후로 선택해 주세요.";
    if (code === "not_setup") return "구글 시트 준비가 끝나지 않았습니다. 교육정보부에 알려 주세요.";
    return "저장하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.";
  }

  // ---------- 구글 시트 연동 ----------
  const configured = /^https:\/\/script\.google\.com\//.test(API_URL);

  function applyState(state) {
    if (!state) return;
    const json = JSON.stringify(state);
    if (json === lastJson && loaded) return; // 바뀐 게 없으면 다시 그리지 않음
    lastJson = json;
    const next = {};
    (state.laptops || []).forEach((l) => { if (l.no >= 1 && l.no <= COUNT) next[l.no] = l; });
    laptops = next;
    loaded = true;
    renderBoard();
    renderLog(state.logs || []);
  }

  async function load() {
    try {
      const res = await fetch(API_URL, { cache: "no-store" });
      const data = await res.json();
      if (!data.ok) throw data;
      applyState(data.state);
      showNotice("");
    } catch (x) {
      if (x && x.error === "not_setup") showNotice("구글 시트 준비가 끝나지 않았습니다. Apps Script에서 setup을 먼저 실행해 주세요.");
      else if (!loaded) showNotice("현황을 불러오지 못했습니다. 인터넷 연결을 확인하고 페이지를 새로 고쳐 주세요.");
      if (!loaded) $("log-empty") && ($("log-empty").textContent = "기록을 불러올 수 없습니다.");
    }
  }

  async function send(body) {
    let data;
    try {
      // text/plain으로 보내야 Apps Script가 브라우저 사전 요청(CORS) 없이 받습니다.
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body),
      });
      data = await res.json();
    } catch (_) {
      throw { code: "network" };
    }
    if (!data.ok) {
      load(); // 다른 사람이 먼저 바꿨을 수 있으니 최신 현황으로 갱신
      throw { code: data.error };
    }
    applyState(data.state);
  }

  // ---------- 시작 ----------
  renderBoard();

  if (!configured) {
    showNotice("저장소 주소가 설정되지 않았습니다. script.js 맨 위의 API_URL에 Apps Script 웹 앱 주소를 넣어 주세요.");
    $("log-empty").textContent = "기록을 불러올 수 없습니다.";
    return;
  }

  load();
  setInterval(() => {
    if (document.visibilityState === "visible" && !busyOp) load();
  }, REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") load();
  });

  // 날짜가 바뀌면 지연 표시를 다시 계산
  let day = todayStr();
  setInterval(() => {
    if (todayStr() !== day) { day = todayStr(); if (loaded) renderBoard(); }
  }, 60 * 1000);
})();
