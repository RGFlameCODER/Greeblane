const $ = (s) => document.querySelector(s);
let sessionData = { user: null, permissions: {}, csrfToken: "" };
const forms = {
  whitelist: { title: "Whitelist Application", intro: "Apply to become a citizen of Greenlane RP.", q1: "Why do you want to join Greenlane RP?", q2: "Explain RDM, VDM and metagaming in your own words." },
  ems: { title: "EMS Application", intro: "Apply to join Emergency Medical Services.", q1: "Why do you want to join EMS, and what makes a good paramedic roleplayer?", q2: "You arrive at a crash with injured people and traffic still moving. What are your first actions?" },
  police: { title: "Police Application", intro: "Apply to join the Greenlane RP Police Department.", q1: "Why do you want to join the police department, and what makes a professional officer?", q2: "You stop a vehicle and the driver becomes aggressive. How do you handle the situation safely and fairly?" }
};
async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  if (options.method && !["GET","HEAD"].includes(options.method.toUpperCase())) headers["X-CSRF-Token"] = sessionData.csrfToken;
  const response = await fetch(url, { credentials: "same-origin", ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }
function date(s) { return new Date(s).toLocaleString(); }
function renderRules(id, rules) {
  const list = $(id); list.replaceChildren();
  (rules || []).forEach(rule => { const li = document.createElement("li"); li.textContent = rule; list.appendChild(li); });
}
async function loadConfig() {
  const c = await api("/api/config");
  $("#discordLink").href = c.discordInviteUrl;
  renderRules("#discordRules", c.rules.discord);
  renderRules("#cityRules", c.rules.city);
  if (!c.oauthConfigured) $("#userStatus").textContent = "Discord sign-in is not configured yet. The owner must complete the deployment setup.";
}
async function loadSession() {
  sessionData = await api("/api/session");
  $("#loginButton").classList.toggle("hidden", Boolean(sessionData.user));
  $("#logoutButton").classList.toggle("hidden", !sessionData.user);
  const status = $("#userStatus");
  if (!sessionData.user) {
    status.innerHTML = 'You are not signed in. <a href="/auth/discord" style="color:var(--green)">Sign in with Discord</a> to submit applications.';
    $("#staff").classList.add("hidden"); $("#myApplications").classList.add("hidden"); return;
  }
  const name = sessionData.user.globalName || sessionData.user.username;
  status.textContent = `Signed in as ${name} (Discord ID: ${sessionData.user.id}).`;
  if (!sessionData.permissions.isMember) status.textContent += " Join the Greenlane RP Discord server to apply.";
  if (sessionData.permissions.isStaff) { $("#staff").classList.remove("hidden"); await loadStaffApplications(); }
  await loadMyApplications();
}
function openApplication(type) {
  if (!sessionData.user) { location.href = "/auth/discord"; return; }
  if (!sessionData.permissions.isMember) { $("#userStatus").textContent = "Join the Greenlane RP Discord server using the Discord button, then refresh this page."; return; }
  const f = forms[type]; $("#applicationType").value = type; $("#modalTitle").textContent = f.title; $("#modalIntro").textContent = f.intro;
  $("#q1Label").textContent = f.q1 + " *"; $("#q2Label").textContent = f.q2 + " *";
  $("#applicationForm").reset(); $("#applicationType").value = type; $("#formFeedback").textContent = "";
  $("#modal").classList.remove("hidden");
}
function closeModal() { $("#modal").classList.add("hidden"); }
async function loadMyApplications() {
  if (!sessionData.user || !sessionData.permissions.isMember) return;
  try {
    const data = await api("/api/applications");
    $("#myApplications").classList.remove("hidden");
    $("#myApplicationList").innerHTML = data.applications.length ? data.applications.map(a => `<div class="app-row"><div><strong>#${a.id} · ${esc(a.application_type.toUpperCase())}</strong><br><small>Submitted ${esc(date(a.submitted_at))}</small>${a.reviewer_notes ? `<p class="muted">Staff note: ${esc(a.reviewer_notes)}</p>` : ""}</div><span class="tag">${esc(a.status.replaceAll("_"," ").toUpperCase())}</span></div>`).join("") : "<p class='muted'>You have not submitted any applications yet.</p>";
  } catch (e) { $("#myApplications").classList.add("hidden"); }
}
$("#applicationForm").addEventListener("submit", async e => {
  e.preventDefault(); const feedback = $("#formFeedback"); feedback.textContent = "Submitting…";
  const payload = {
    applicationType: $("#applicationType").value, applicantName: $("#applicantName").value,
    age: Number($("#age").value), experience: $("#experience").value, answerOne: $("#answerOne").value,
    answerTwo: $("#answerTwo").value, availability: $("#availability").value
  };
  try {
    const result = await api("/api/applications", { method: "POST", body: JSON.stringify(payload) });
    feedback.textContent = `Submitted successfully. Your application reference is #${result.application.id}.`;
    await loadMyApplications();
    setTimeout(closeModal, 1400);
  } catch (err) { feedback.textContent = err.message; }
});
function statusOptions(selected) { return ["pending","in_review","approved","rejected","changes_requested"].map(s => `<option value="${s}" ${s===selected?"selected":""}>${s.replaceAll("_"," ")}</option>`).join(""); }
async function loadStaffApplications() {
  if (!sessionData.permissions.isStaff) return;
  const q = new URLSearchParams();
  if ($("#filterStatus").value) q.set("status", $("#filterStatus").value);
  if ($("#filterType").value) q.set("type", $("#filterType").value);
  if ($("#filterSearch").value.trim()) q.set("search", $("#filterSearch").value.trim());
  const holder = $("#staffApplications"); holder.textContent = "Loading applications…";
  try {
    const data = await api("/api/staff/applications?" + q.toString());
    holder.innerHTML = data.applications.length ? data.applications.map(a => `<article class="application-card" data-app="${a.id}"><div class="app-row"><div><strong>#${a.id} · ${esc(a.application_type.toUpperCase())}</strong><br>${esc(a.applicant_name)} · age ${a.age}<br><small>${esc(a.discord_username)} · Discord ID ${esc(a.discord_id)} · ${esc(date(a.submitted_at))}</small></div><span class="tag">${esc(a.status.toUpperCase())}</span></div><p><strong>Experience:</strong> ${esc(a.experience)}</p><p><strong>Question 1:</strong></p><div class="answer">${esc(a.answer_one)}</div><p><strong>Question 2:</strong></p><div class="answer">${esc(a.answer_two)}</div><p><strong>Availability:</strong></p><div class="answer">${esc(a.availability || "Not supplied")}</div><div class="admin-controls spacerTop"><div class="field"><label>Status</label><select class="appStatus">${statusOptions(a.status)}</select></div><div class="field"><label>Reviewer notes (visible to applicant)</label><textarea class="reviewerNotes" rows="2">${esc(a.reviewer_notes)}</textarea></div><button class="btn saveApplication" data-id="${a.id}">Save review</button></div><p class="feedback"></p></article>`).join("") : "<p class='muted'>No applications match these filters.</p>";
  } catch (e) { holder.textContent = e.message; }
}
$("#staffApplications").addEventListener("click", async e => {
  const btn = e.target.closest(".saveApplication"); if (!btn) return;
  const card = btn.closest("[data-app]"); const feedback = card.querySelector(".feedback");
  try {
    await api(`/api/staff/applications/${btn.dataset.id}`, { method:"PATCH", body:JSON.stringify({ status:card.querySelector(".appStatus").value, reviewerNotes:card.querySelector(".reviewerNotes").value }) });
    feedback.textContent = "Review saved."; await loadStaffApplications();
  } catch (err) { feedback.textContent = err.message; }
});
async function loadRulesEditor() {
  if (!sessionData.permissions.canEditRules) { $("#rulesTab").innerHTML = "<p class='muted'>Your Discord role does not allow editing rules.</p>"; return; }
  try {
    const data = await api("/api/staff/rules");
    for (const r of data.rules) $(`#edit${r.rule_key==="discord"?"Discord":"City"}Rules`).value = r.rules.join("\n");
  } catch (e) { $("#rulesFeedback").textContent = e.message; }
}
document.querySelectorAll(".saveRules").forEach(btn => btn.addEventListener("click", async () => {
  const key = btn.dataset.key, id = key === "discord" ? "#editDiscordRules" : "#editCityRules";
  const rules = $(id).value.split("\n").map(s => s.trim()).filter(Boolean);
  try {
    await api(`/api/staff/rules/${key}`, { method:"PUT", body:JSON.stringify({ rules }) });
    renderRules(key === "discord" ? "#discordRules" : "#cityRules", rules);
    $("#rulesFeedback").textContent = `${key} rules saved to the database.`;
  } catch (e) { $("#rulesFeedback").textContent = e.message; }
}));
async function loadAudit() {
  try {
    const data = await api("/api/staff/audit");
    $("#auditList").innerHTML = data.events.map(e => `<div class="audit-row"><strong>${esc(e.action)}</strong> · ${esc(e.target_type)} ${esc(e.target_id || "")}<small>By Discord ID ${esc(e.actor_discord_id)} · ${esc(date(e.created_at))}</small><small>${esc(JSON.stringify(e.details))}</small></div>`).join("");
  } catch (e) { $("#auditList").textContent = e.message; }
}
document.querySelectorAll(".staffTab").forEach(btn => btn.addEventListener("click", async () => {
  document.querySelectorAll(".staffPanel").forEach(p => p.classList.add("hidden"));
  $("#" + btn.dataset.tab).classList.remove("hidden");
  if (btn.dataset.tab === "rulesTab") await loadRulesEditor();
  if (btn.dataset.tab === "auditTab") await loadAudit();
}));
$("#loginButton").addEventListener("click", () => location.href = "/auth/discord");
$("#logoutButton").addEventListener("click", async () => { try { await api("/auth/logout", { method:"POST", body:"{}" }); location.reload(); } catch (e) { alert(e.message); } });
$("#closeModal").addEventListener("click", closeModal); $("#cancelApplication").addEventListener("click", closeModal);
$("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });
document.querySelectorAll(".applyBtn").forEach(btn => btn.addEventListener("click", () => openApplication(btn.dataset.type)));
$("#refreshApplications").addEventListener("click", loadStaffApplications);
$("#filterStatus").addEventListener("change", loadStaffApplications); $("#filterType").addEventListener("change", loadStaffApplications);
let searchTimer; $("#filterSearch").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadStaffApplications, 250); });
$("#refreshAudit").addEventListener("click", loadAudit);
$("#year").textContent = new Date().getFullYear();
(async function init() { try { await loadConfig(); await loadSession(); } catch (e) { $("#userStatus").textContent = "The server is starting or not fully configured yet. Check the deployment logs and README."; console.error(e); } })();
