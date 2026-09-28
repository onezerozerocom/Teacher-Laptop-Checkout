(function () {
  const COUNT = 15;
  const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
  const tabId = "tab-" + Math.random().toString(36).slice(2, 10);

  let db = null;
  let laptops = {};        // 번호 -> 문서 내용
  let loaded = false;
  let readOnly = false;
  let busyOp = false;

  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, "0");
  const docId = (n) => "laptop-" + pad(n);

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
    const w = WEEK[new Date(y, m - 1, d).getDay()];
    return m + "월 " + d + "일(" + w + ")";
  }
  function fmtAt(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.getFullYear() + "." + pad(d.getMonth() + 1) + "." + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
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
      b.disabled = !loaded || !db;

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
      if (loaded && db && !readOnly) {
        const act = document.createElement("span");
        act.className = "act";
        act.textContent = rented ? "반납하기 →" : "대여하기 →";
        b.append(act);
      }
      b.setAttribute("aria-label", "노트북 " + n + "번, " + pill.textContent + (rented ? ", " + l.teacher + " 선생님, 반납 예정 " + fmtDue(l.due) : ""));
      b.addEventListener("click", () => {
        if (readOnly) { showToast("대여·반납 권한이 없습니다. 교육정보부에 문의하세요."); return; }
        rented ? openReturn(n) : openRent(n);
      });
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
          await rent(n, name, due);
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
          await giveBack(n);
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
    if (code === "busy") return "다른 분이 같은 노트북을 처리하고 있습니다. 잠시 후 다시 눌러 주세요.";
    if (code === "invalid_argument") {
      readOnly = true;
      renderBoard();
      return "대여·반납 권한이 없습니다. 교육정보부에 '참여자' 권한을 요청해 주세요.";
    }
    if (code === "quota_exceeded") return "저장 공간이 가득 찼습니다. 교육정보부에 알려 주세요.";
    return "저장하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.";
  }

  // ---------- 저장 ----------
  async function withLock(n, fn) {
    const ref = db.doc("laptops/" + docId(n));
    const lease = await ref.acquire({ holder: tabId, ttlMs: 8000 });
    if (!lease.acquired) throw { code: "busy" };
    const snap = await ref.get();
    const cur = snap.exists ? snap.data() || {} : {};
    return fn(ref, cur);
  }

  async function rent(n, name, due) {
    const at = new Date().toISOString();
    await withLock(n, async (ref, cur) => {
      if (cur.status === "rented") throw { code: "taken" };
      await ref.set({ no: n, status: "rented", teacher: name, due: due, rentedAt: at });
    });
    await db.collection("logs").add({ at: at, device: n, teacher: name, type: "rent" });
  }

  async function giveBack(n) {
    const at = new Date().toISOString();
    let teacher = "";
    await withLock(n, async (ref, cur) => {
      if (cur.status !== "rented") throw { code: "already_returned" };
      teacher = cur.teacher || "";
      await ref.set({ no: n, status: "available", returnedAt: at });
    });
    await db.collection("logs").add({ at: at, device: n, teacher: teacher, type: "return" });
  }

  // ---------- 시작 ----------
  renderBoard();

  (async function start() {
    const cl = window.claude;
    db = cl && cl.use ? await cl.use("db").catch(() => null) : null;
    if (!db) {
      showNotice("공유 저장소에 연결할 수 없어 현황을 불러오지 못했습니다. 페이지를 새로 고치거나 교육정보부에 문의해 주세요.");
      $("log-empty").textContent = "기록을 불러올 수 없습니다.";
      return;
    }

    const user = await (cl.use("user").catch(() => null));
    if (user && typeof user.can === "function") {
      try {
        const w = await user.can("data.write");
        if (w === false) {
          readOnly = true;
          showNotice("보기 전용으로 접속했습니다. 대여·반납하려면 교육정보부에 '참여자' 권한을 요청해 주세요.");
        }
      } catch (_) {}
    }

    db.collection("laptops").onSnapshot((snap) => {
      const next = {};
      snap.docs.forEach((d) => {
        const v = d.data() || {};
        const n = Number(v.no) || Number(d.id.replace("laptop-", ""));
        if (n >= 1 && n <= COUNT) next[n] = v;
      });
      laptops = next;
      loaded = true;
      renderBoard();
    }, () => {
      showNotice("현황 연결이 끊어졌습니다. 페이지를 새로 고쳐 주세요.");
    });

    db.collection("logs").orderBy("at", "desc").limit(100).onSnapshot((snap) => {
      renderLog(snap.docs.map((d) => d.data() || {}));
    }, () => {
      $("log-empty") && ($("log-empty").textContent = "기록을 불러올 수 없습니다.");
    });

    // 날짜가 바뀌면 지연 표시를 다시 계산
    let day = todayStr();
    setInterval(() => {
      if (todayStr() !== day) { day = todayStr(); if (loaded) renderBoard(); }
    }, 60 * 1000);
  })();
})();
