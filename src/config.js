const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const config = {
  siteName: process.env.SITE_NAME || "NARFwiki",
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 3000),
  botPort: Number(process.env.BOT_PORT || 3001),
  siteSecret: process.env.SITE_SECRET || "dev-secret-change-me",
  dbUrl:
    process.env.DB_URL ||
    "postgresql://postgres:postgres@localhost:5432/narfwiki",
  adminBootstrapUser: process.env.ADMIN_BOOTSTRAP_USER || "admin",
  adminBootstrapPass: process.env.ADMIN_BOOTSTRAP_PASS || "admin",
  botApiToken: process.env.BOT_API_TOKEN || "local-dev-bot-token",
  whatsappBotToken: process.env.WHATSAPP_BOT_TOKEN || "",
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "",
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
  glmApiKey: process.env.GLM_API_KEY || "",
  glmBaseUrl:
    process.env.GLM_BASE_URL || "https://api.z.ai/api/paas/v4/",
  glmModel: process.env.GLM_MODEL || "glm-5",
  whitelistedPhones: (process.env.WHITELISTED_PHONES || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
};

module.exports = config;
