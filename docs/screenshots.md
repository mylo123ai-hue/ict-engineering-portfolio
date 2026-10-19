# Portfolio screenshot gallery

The final-cycle screenshots below were captured in real headless Chromium from the running application, using an isolated temporary SQLite database and synthetic casebook records. They are not mockups or generated interface art. The server remained on `127.0.0.1`; no external hosts were contacted.

## Portfolio overview

| Desktop · 1440 px | Mobile · 390 px |
| --- | --- |
| [![Desktop overview showing the five application cards, synthetic operational snapshot, and SQLite saved indicator](screenshots/final-cycle/homepage-desktop.jpg)](screenshots/final-cycle/homepage-desktop.jpg) | [![Mobile overview showing the responsive navigation, synthetic metrics, and five application cards](screenshots/final-cycle/homepage-mobile.jpg)](screenshots/final-cycle/homepage-mobile.jpg) |

## Application workflow states

Each view shows a completed, saved synthetic workflow, not a real production incident or change.

### 1. Infrastructure Health Monitor

ERP host investigation is resolved after recording a post-action check. The separate East wing access point alert remains open, reflecting the scenario rather than falsely marking the entire estate healthy.

![Chromium capture of the health monitor with ERP CPU at 61%, queue depth 8, the application server healthy, and one separate AP alert still open](screenshots/final-cycle/health-recovery.jpg)

### 2. Security Findings Dashboard

SEC-2418 includes an assigned owner, remediation plan, resolved state, and verification evidence. Other synthetic findings remain in the risk register.

![Chromium capture of the security dashboard with SEC-2418 resolved and its owner, plan, and validation evidence visible](screenshots/final-cycle/security-remediation.jpg)

### 3. IT Helpdesk Ticket System

HD-1049 is assigned and in progress. Its first response, work note, priority, and response target are shown in the queue.

![Chromium capture of the helpdesk queue with the East wing Wi-Fi ticket assigned to an engineer and first response recorded](screenshots/final-cycle/helpdesk-first-response.jpg)

### 4. Network Fault Isolation Tool

The East wing packet-loss scenario compares impact, client link, gateway, and upstream path. The UI presents a likely local wireless fault domain and the next discriminating test; it makes no live probes.

![Chromium capture of a network isolation sequence with the East wing wireless access point or local uplink as the likely fault domain](screenshots/final-cycle/network-isolation.jpg)

The browser workflow also handed the diagnostic evidence to a new helpdesk ticket; the created ticket and evidence were read back from SQLite.

### 5. Maintenance Approval & Rollback

CHG-208 passes readiness review, starts within its approved window, fails post-change validation, then records restoration and a passing recovery check.

![Chromium capture of the maintenance case showing the rollback status and its approval, implementation, failed validation, and recovery decision log](screenshots/final-cycle/maintenance-rollback.jpg)

## Earlier before-and-after homepage captures

The earlier files below are retained to show the recruiter-facing frontend redesign from the previous improvement cycle. They are separate from the final-cycle browser captures above.

| Baseline desktop | Previous-cycle desktop |
| --- | --- |
| ![Baseline homepage capture](homepage.jpg) | ![Previous-cycle homepage capture](homepage-v3.jpg) |

| Baseline mobile | Previous-cycle mobile |
| --- | --- |
| ![Baseline mobile homepage capture](homepage-mobile.jpg) | ![Previous-cycle mobile homepage capture](homepage-mobile-v3.jpg) |

Additional prior-cycle captures are available for the [five applications](apps/), the [SQLite-connected homepage](homepage-backend.jpg), and the [backend cycle](homepage-backend-cycle.png). See the [verification record](verification.md) for the steps and limits of each recorded browser check.
