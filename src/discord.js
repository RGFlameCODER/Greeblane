import dotenv from "dotenv";
dotenv.config();

const API = "https://discord.com/api/v10";
const splitIds = (value = "") => value.split(",").map((s) => s.trim()).filter(Boolean);

export function getDiscordConfig() {
  return {
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    redirectUri: process.env.DISCORD_REDIRECT_URI,
    guildId: process.env.DISCORD_GUILD_ID,
    botToken: process.env.DISCORD_BOT_TOKEN,
    staffRoleIds: splitIds(process.env.DISCORD_STAFF_ROLE_IDS),
    rulesAdminRoleIds: splitIds(process.env.DISCORD_RULES_ADMIN_ROLE_IDS),
    superAdminUserIds: splitIds(process.env.SUPER_ADMIN_USER_IDS),
    inviteUrl: process.env.DISCORD_INVITE_URL || "https://discord.com/"
  };
}

export function oauthConfigured() {
  const c = getDiscordConfig();
  return Boolean(c.clientId && c.clientSecret && c.redirectUri);
}

export async function exchangeCode(code) {
  const c = getDiscordConfig();
  const body = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: c.redirectUri
  });
  const response = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error("Discord token exchange failed");
  const userResponse = await fetch(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${data.access_token}` }
  });
  const user = await userResponse.json();
  if (!userResponse.ok || !user.id) throw new Error("Could not identify Discord user");
  return user;
}

// Role authorization is checked server-side against current guild membership.
export async function getGuildMember(discordId) {
  const c = getDiscordConfig();
  if (!c.guildId || !c.botToken) throw new Error("Discord guild/bot configuration is missing");
  const response = await fetch(`${API}/guilds/${c.guildId}/members/${discordId}`, {
    headers: { Authorization: `Bot ${c.botToken}` }
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Discord member lookup failed (${response.status})`);
  return response.json();
}

export async function getPermissions(discordId) {
  const c = getDiscordConfig();
  const isSuperAdmin = c.superAdminUserIds.includes(discordId);
  let member = null;
  try {
    member = await getGuildMember(discordId);
  } catch (error) {
    return { isMember: false, isStaff: isSuperAdmin, canEditRules: isSuperAdmin, error: error.message };
  }
  const roles = member?.roles || [];
  const isStaff = isSuperAdmin || c.staffRoleIds.some((id) => roles.includes(id));
  const ruleRoles = c.rulesAdminRoleIds.length ? c.rulesAdminRoleIds : c.staffRoleIds;
  const canEditRules = isSuperAdmin || ruleRoles.some((id) => roles.includes(id));
  return { isMember: Boolean(member), isStaff, canEditRules, roles };
}

export async function sendApplicationNotification(application) {
  const c = getDiscordConfig();
  if (!c.botToken || !c.guildId) throw new Error("Discord bot is not configured");
  const channelId = process.env.DISCORD_APPLICATIONS_CHANNEL_ID;
  if (!channelId) throw new Error("Missing DISCORD_APPLICATIONS_CHANNEL_ID");
  const safe = (value) => String(value ?? "").replace(/@/g, "@\u200b").slice(0, 500);
  const content = [
    "📨 **New Greenlane RP application**",
    `**Type:** ${safe(application.application_type)}`,
    `**Application ID:** #${application.id}`,
    `**Applicant:** ${safe(application.applicant_name)}`,
    `**Discord:** <@${application.discord_id}> (\`${safe(application.discord_id)}\`)`,
    `**Status:** ${safe(application.status)}`,
    `Review it in the Greenlane RP staff dashboard.`
  ].join("\n");
  const response = await fetch(`${API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${c.botToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } })
  });
  if (!response.ok) throw new Error(`Discord notification failed (${response.status})`);
  return response.json();
}
