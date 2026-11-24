import { API, STATIONS } from "./config.js";
const $ = (s) => document.querySelector(s);
const keys = Object.keys(STATIONS),
  book = $("#book");

// Si llegó por el QR/NFC de una estación, lo guardamos (por si aún no se registra)
const p = new URLSearchParams(location.search);
if (STATIONS[p.get("s")])
  sessionStorage.pending = JSON.stringify({ s: p.get("s"), k: p.get("k") });
history.replaceState(null, "", location.pathname);

let me = JSON.parse(localStorage.pasaporte || "null"),
  loading = null,
  newKey = null,
  busy = "",
  draft = null, // datos del paso 1
  mode = "", // "reg" | "edit"
  data = [], // horarios con cupos
  sel = {}, // "dia+hora" -> id del slot elegido
  day = "sab", // pestaña activa
  mineList = []; // mis reservas (para el calendario)
const save = () => (localStorage.pasaporte = JSON.stringify(me));
const call = async (b) =>
  (await fetch(API, { method: "POST", body: JSON.stringify(b) })).json();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function toast(t, ms = 3500) {
  const el = $("#toast");
  el.textContent = t;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), ms);
}

// ---- Librito ----
function fit() {
  const open = book.classList.contains("open"),
    vw = innerWidth;
  $("#stage").style.setProperty(
    "--s",
    open ? Math.min(1.1, (vw * 0.96) / 600) : Math.min(1.1, (vw * 0.84) / 300),
  );
  hint();
}
function setOpen(o) {
  book.classList.toggle("open", o);
  fit();
}
function hint() {
  const h = $("#hint");
  h.classList.toggle("dots", !!busy);
  h.textContent =
    busy ||
    (book.classList.contains("open")
      ? "Toca para cerrar tu pasaporte"
      : "Toca tu pasaporte para abrirlo");
}
book.addEventListener("click", () => setOpen(!book.classList.contains("open")));
book.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    book.click();
  }
});
addEventListener("resize", fit);

const slot = (k) => {
  const st = STATIONS[k],
    on = me.stamps[k];
  return (
    `<div class="slot"><span class="pill"><i>0${st.n}</i>${st.label}</span><div class="ring ${loading === k ? "load" : ""}">` +
    (loading === k ? '<i class="spin"></i>' : "") +
    (on
      ? `<img class="${newKey === k ? "new" : ""}" src="img/${k}.png" alt="Sello ${st.label}" onerror="this.outerHTML='<span class=fb>✓</span>'">`
      : "") +
    `</div></div>`
  );
};
const foot = (t, hit) => `<div class="foot ${hit ? "hit" : ""}">${t}</div>`;

function render() {
  $("#reg").hidden = true;
  $("#sched").hidden = true;
  $("#pass").hidden = false;
  $("#who").textContent = me.name;
  const done = keys.filter((k) => me.stamps[k]).length;
  $("#n").textContent = done;
  $("#left").innerHTML =
    slot("train") + slot("fuel") + foot("3 misiones · Recompensa", done >= 3);
  $("#right").innerHTML =
    slot("recover") +
    slot("recharge") +
    slot("mindset") +
    foot("5 misiones · Nivel máximo", done >= 5);
  fit();
  loadMine();
}

function boom() {
  if (matchMedia("(prefers-reduced-motion:reduce)").matches) return;
  for (let i = 0; i < 40; i++) {
    const s = document.createElement("span");
    s.className = "cf";
    s.style.cssText = `left:${Math.random() * 100}vw;background:${i % 2 ? "#d9a9ee" : "#3f7d1c"};animation-delay:${Math.random() * 0.5}s`;
    document.body.append(s);
    setTimeout(() => s.remove(), 2800);
  }
}

async function stampPending() {
  const pend = JSON.parse(sessionStorage.pending || "null");
  if (!pend || !me) return;
  const label = STATIONS[pend.s].label;
  setOpen(true);
  loading = pend.s;
  busy = `Estampando tu sello de ${label}`;
  render();
  try {
    const [r] = await Promise.all([
      call({ a: "stamp", id: me.id, ...pend }),
      wait(1100),
    ]);
    if (!r.ok && r.error === "id") {
      localStorage.removeItem("pasaporte");
      location.reload();
      return;
    }
    sessionStorage.removeItem("pending");
    loading = null;
    busy = "";
    if (!r.ok) {
      render();
      return toast("Este QR no es válido.");
    }
    me.stamps = r.stamps;
    save();
    newKey = r.isNew ? pend.s : null;
    render();
    newKey = null;
    if (r.isNew) {
      navigator.vibrate?.(40);
      const n = Object.keys(r.stamps).length;
      if (n === 5) {
        boom();
        toast("¡Nivel máximo! 🎉", 5000);
      } else if (n === 3) toast("¡Recompensa desbloqueada!", 5000);
      else toast(`¡Sello de ${label} desbloqueado!`);
    } else toast(`Ya tenías el sello de ${label}`);
  } catch (e) {
    loading = null;
    busy = "";
    render();
    toast("Sin conexión. Recarga la página para reintentar.", 6000);
  }
}

// ---- Horarios ----
const fmt = (h) => {
  const hh = +h.slice(0, 2);
  return `${hh}:${h.slice(2)} – ${hh + 1}:00`;
};
const DAYN = { sab: "Sábado 28", dom: "Domingo 29" };
const DAYORD = { sab: 0, dom: 1 };
const nm = (id) => {
  const s = data.find((x) => x.id === id);
  return s ? `${s.act} (${DAYN[s.d]} ${fmt(s.h)})` : id;
};

function renderPicker() {
  const by = {};
  data.filter((s) => s.d === day).forEach((s) => (by[s.h] ||= []).push(s));
  const count = (d) => Object.keys(sel).filter((k) => k.startsWith(d)).length;
  $("#slots").innerHTML =
    '<div class="tabs">' +
    Object.keys(DAYN)
      .map(
        (d) =>
          `<button type="button" class="tab ${d === day ? "on" : ""}" data-d="${d}">${DAYN[d]}${count(d) ? " · " + count(d) : ""}</button>`,
      )
      .join("") +
    "</div>" +
    Object.keys(by)
      .sort()
      .map(
        (h) =>
          `<div class="blk"><h3>${fmt(h)}</h3><div class="opts">` +
          by[h]
            .map((s) => {
              const on = sel[day + h] === s.id,
                full = s.left <= 0 && !s.mine;
              return `<button type="button" class="opt ${on ? "on" : ""}" data-h="${h}" data-id="${s.id}" ${full ? "disabled" : ""}>${s.act}<small>${full ? "Lleno" : s.left + " lugares"}</small></button>`;
            })
            .join("") +
          `</div></div>`,
      )
      .join("");
}

$("#slots").addEventListener("click", (e) => {
  const t = e.target.closest(".tab");
  if (t) {
    day = t.dataset.d;
    return renderPicker();
  }
  const b = e.target.closest(".opt");
  if (!b || b.disabled) return;
  const { h, id } = b.dataset,
    k = day + h;
  if (sel[k] === id) delete sel[k];
  else {
    // Solo 1 vez por actividad (cada día): si ya la tenía en otra hora, se mueve a esta
    const act = data.find((x) => x.id === id).act;
    for (const o in sel) {
      if (
        o !== k &&
        o.startsWith(day) &&
        data.find((x) => x.id === sel[o]).act === act
      ) {
        delete sel[o];
        toast(
          `${act} solo se puede reservar una vez al día. Lo cambiamos a ${fmt(h)}.`,
          4500,
        );
      }
    }
    sel[k] = id;
  }
  renderPicker();
});

async function openPicker(m) {
  mode = m;
  $("#reg").hidden = true;
  $("#pass").hidden = true;
  $("#sched").hidden = false;
  $("#ok").textContent =
    m === "reg" ? "Crear mi pasaporte" : "Guardar horarios";
  $("#ok").disabled = true;
  $("#slots").innerHTML = '<p class="sub">Cargando horarios…</p>';
  try {
    const r = await call({ a: "slots", id: me?.id });
    if (!r.ok) throw new Error(r.error || "respuesta inválida");
    data = r.slots;
    sel = {};
    data.filter((s) => s.mine).forEach((s) => (sel[s.d + s.h] = s.id));
    renderPicker();
    $("#ok").disabled = false;
  } catch (e) {
    console.error(e);
    $("#slots").innerHTML =
      `<p class="sub">No se pudieron cargar los horarios.<br><small>${e.message}</small></p>`;
    toast("Sin conexión. Intenta de nuevo.");
    $("#ok").disabled = m === "reg" ? false : true; // en registro se puede continuar sin horarios
  }
}

$("#ok").addEventListener("click", async () => {
  const btn = $("#ok"),
    txt = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Guardando…";
  try {
    const slots = Object.values(sel);
    let r;
    if (mode === "reg") {
      r = await call({ a: "register", ...draft, slots });
      if (!r.ok) throw 0;
      me = { id: r.id, name: r.name, stamps: r.stamps };
      save();
    } else {
      r = await call({ a: "reserve", id: me.id, slots });
      if (!r.ok && r.error === "id") {
        localStorage.removeItem("pasaporte");
        location.reload();
        return;
      }
      if (!r.ok) throw 0;
    }
    render();
    if (r.failed?.length)
      toast(
        `Ya no había lugar en: ${r.failed.map(nm).join(", ")}. Elige otro en "Mis horarios".`,
        7000,
      );
    else if (mode === "edit")
      toast(
        "¡Horarios guardados! Vuelve a tocar «Agregar a mi calendario».",
        5000,
      );
    if (mode === "reg") stampPending();
  } catch (e) {
    toast("No se pudo guardar. Intenta de nuevo.");
  }
  btn.disabled = false;
  btn.textContent = txt;
});

$("#back").addEventListener("click", () => {
  if (mode === "reg") {
    $("#sched").hidden = true;
    $("#reg").hidden = false;
  } else render();
});
$("#edit").addEventListener("click", () => openPicker("edit"));

async function loadMine() {
  try {
    const r = await call({ a: "slots", id: me.id });
    if (!r.ok) return;
    mineList = r.slots
      .filter((s) => s.mine)
      .sort((a, b) => DAYORD[a.d] - DAYORD[b.d] || a.h.localeCompare(b.h));
    $("#mine").innerHTML = mineList.length
      ? "<h3>Mis horarios</h3>" +
        mineList
          .map((s) => `<p>${DAYN[s.d]} · ${fmt(s.h)} · <b>${s.act}</b></p>`)
          .join("")
      : "";
    $("#cal").hidden = !mineList.length;
  } catch (e) {}
}

// ---- Calendario (.ics) ----
const EVENT_DAYS = { sab: [2026, 10, 28], dom: [2026, 10, 29] }; // año, mes (0 = enero, 10 = noviembre), día
const TZ_OFFSET = 6; // Ciudad de México = UTC-6
const ics = (d) => d.toISOString().replace(/[-:]|\.\d{3}/g, "");

$("#cal").addEventListener("click", () => {
  const stamp = ics(new Date());
  const ev = mineList.map((s) => {
    const [y, m, d] = EVENT_DAYS[s.d];
    const hh = +s.h.slice(0, 2),
      mm = +s.h.slice(2);
    const start = new Date(Date.UTC(y, m, d, hh + TZ_OFFSET, mm));
    const end = new Date(Date.UTC(y, m, d, hh + 1 + TZ_OFFSET, 0));
    return [
      "BEGIN:VEVENT",
      `UID:${me.id}-${s.id}@pasaporte`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${ics(start)}`,
      `DTEND:${ics(end)}`,
      `SUMMARY:${s.act} · Playbook House`,
      "BEGIN:VALARM",
      "TRIGGER:-PT10M",
      "ACTION:DISPLAY",
      `DESCRIPTION:${s.act} empieza en 10 minutos`,
      "END:VALARM",
      "END:VEVENT",
    ].join("\r\n");
  });
  const file = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Playbook House//Pasaporte//ES",
    ...ev,
    "END:VCALENDAR",
  ].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([file], { type: "text/calendar" }));
  a.download = "mis-horarios.ics";
  a.click();
  toast("Ábrelo para agregarlo a tu calendario");
});

// ---- Registro (paso 1) ----
$("#f").addEventListener("submit", (e) => {
  e.preventDefault();
  draft = Object.fromEntries(new FormData(e.target));
  openPicker("reg");
});

if (me) {
  render();
  stampPending();
} else $("#reg").hidden = false;
