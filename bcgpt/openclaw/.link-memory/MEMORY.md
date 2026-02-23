# Link's Long-Term Memory

**Created:** 2026-02-23
**Last Updated:** 2026-02-23

---

## Identity

I am **Link** 🗡️ - a personal AI assistant for Rajan. I run on OpenClaw and work autonomously to help with PMOS development, system monitoring, and whatever else is needed.

---

## Credentials (CRITICAL - DO NOT LOSE)

Credentials are stored in multiple locations for redundancy:
- `~/.git-credentials` - Git credentials
- `/data/openclaw/memory/link.json` - JSON backup
- `/root/.openclaw/workspace/memory/2026-02-22.md` - Daily notes backup

**GitHub:** Token stored in `~/.git-credentials`
**Tailscale:** Auth key in `/var/lib/tailscale/tailscaled.state`
**Coolify:** API token in openclaw.json

---

## Network

### Tailscale Devices
| IP | Device | Owner |
|---|---|---|
| 100.66.171.41 | This container | Link |
| 100.75.179.35 | laptop-dii0niu1 | Rajan (Windows) |
| 100.98.85.81 | ipad-pro-11-4th-gen | Rajan |
| 100.76.84.28 | xiaomi-25010pn30g | Rajan (Android) |

### Services
- **PMOS:** https://os.wickedlab.io
- **Gateway:** https://cw08o40wo4c0gg8w0owkocow.46.225.102.175.sslip.io
- **Coolify:** https://cpanel.wickedlab.io

---

## Projects

### PMOS (Wicked OS)
- **URL:** https://os.wickedlab.io
- **Repo:** /root/.openclaw/workspace/bcgpt
- **GitHub:** wickeddevsupport/bcgpt
- **Status:** Active development

### Recent Commits by Link
- `95f52c1f` - Fix: Redirect non-superadmin users from restricted tabs to dashboard

---

## Configuration

### OpenClaw Config
- **Location:** `/data/openclaw/openclaw.json`
- **Memory backend:** builtin
- **Gateway port:** 3000
- **Exec security:** full (no approvals needed)

### My Model
- **Primary:** kilo/z-ai/glm-5:free (GLM-5 Free)
- **Fallback:** nvidia-nim/moonshotai/kimi-k2.5

---

## Lessons Learned

1. **NEVER reinstall software that's already installed** - always try restarting first
2. **Approvals file:** `/root/.openclaw/exec-approvals.json`
3. **Persistent workspace:** `/data/openclaw/workspace-personal-assistant/` (git-synced)
4. **Memory location:** This file! MEMORY.md

---

## Daily Notes

### 2026-02-22
- Fixed relogin overlay issue for non-superadmin users
- Set up full autonomy (no approvals)
- Configured Tailscale, GitHub push access
- Created persistent memory system

### 2026-02-23
- Moved memory to persistent workspace with git sync
- Updated USER.md with Rajan's info
