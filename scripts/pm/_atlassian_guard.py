"""Defense-in-depth allowlist for the PM scripts' Atlassian targets.

History: this repo's PM tooling once pointed at the wrong Atlassian site
(tasteslikegood-dev.atlassian.net) and misfiled work items across projects.
tasteslikegood.atlassian.net is the ONLY site for work items; this repo's
tooling may only touch the recipe-app Jira projects (KAN, RCP). The plaza-game
projects (PLZG, TO) live on the same main site but belong to a different repo,
and the -dev service site's former TO project is frozen as TOSVC
("SERVICE-HOLD — do not use").

Call these validators wherever a site URL or Jira project key is about to be
used (config load, request construction). They raise AtlassianGuardError with
a loud, descriptive message — they never silently correct.

Standard-library only, so it stays importable before project dependencies are
installed (same constraint as _jira_projects.py and atlassian_pm_link.py).
"""

from __future__ import annotations

from typing import Iterable
from urllib.parse import urlsplit

# The only Atlassian site this repo's tooling may talk to.
ALLOWED_ATLASSIAN_SITE = "tasteslikegood.atlassian.net"

# The only Jira projects this repo's tooling may WRITE to.
ALLOWED_JIRA_PROJECT_KEYS = ("KAN", "RCP")

# Projects readable for cross-project rollups/briefings (never written to).
# The plaza-game projects live on the same main site; reading them for a
# portfolio view is safe — filing/updating items in them is not.
READ_ONLY_JIRA_PROJECT_KEYS = ("KAN", "RCP", "PLZG", "TO")

# Known-bad site kept by name so the error message can explain the history.
_SERVICE_SITE = "tasteslikegood-dev.atlassian.net"


class AtlassianGuardError(RuntimeError):
    """Raised when PM tooling is pointed at a disallowed Atlassian site or project."""


def _extract_host(value: str) -> str:
    """Extract the lowercase hostname from a URL or bare host string."""
    value = (value or "").strip()
    if not value:
        return ""
    if "://" in value:
        host = urlsplit(value).hostname or ""
    else:
        # Bare host, possibly with a port or trailing path (e.g. "host/wiki").
        host = urlsplit(f"//{value}").hostname or ""
    return host.lower().rstrip(".")


def validate_atlassian_site(url_or_host: str) -> str:
    """Validate a site URL/hostname against the allowlist.

    Returns the normalized hostname (scheme, port, and path stripped) on
    success. Raises AtlassianGuardError for any other host — including the
    tasteslikegood-dev service site — instead of silently correcting.
    """
    host = _extract_host(url_or_host)
    if host == ALLOWED_ATLASSIAN_SITE:
        return host

    if host == _SERVICE_SITE or host.endswith("." + _SERVICE_SITE):
        raise AtlassianGuardError(
            f"BLOCKED: Atlassian site {host!r} (from {url_or_host!r}) is the service-site "
            f"shell, NOT this repo's work-item site.\n"
            f"This repo's PM tooling may ONLY talk to: {ALLOWED_ATLASSIAN_SITE}\n"
            f"{_SERVICE_SITE} previously received misfiled work items; its former TO "
            f"project is frozen as TOSVC (SERVICE-HOLD — do not use).\n"
            f"Fix ATLASSIAN_URL in .env — do not point this repo's tooling at the -dev site."
        )

    raise AtlassianGuardError(
        f"BLOCKED: Atlassian site {host or url_or_host!r} is not on this repo's allowlist.\n"
        f"This repo's PM tooling may ONLY talk to: {ALLOWED_ATLASSIAN_SITE}\n"
        f"Fix ATLASSIAN_URL in .env — never point this repo's tooling at another site."
    )


def validate_jira_project_key(key: str, *, read_only: bool = False) -> str:
    """Validate a single Jira project key against the allowlist.

    Returns the normalized (stripped, uppercased) key on success. Raises
    AtlassianGuardError instead of silently correcting.

    ``read_only=False`` (the default) is the WRITE allowlist: KAN/RCP only.
    ``read_only=True`` additionally admits the plaza-game projects (PLZG, TO)
    for cross-project rollups and briefings that never write to Jira. Only
    pass it from code paths that exclusively read.
    """
    normalized = (key or "").strip().upper()
    allowed = READ_ONLY_JIRA_PROJECT_KEYS if read_only else ALLOWED_JIRA_PROJECT_KEYS
    if normalized in allowed:
        return normalized

    if read_only:
        raise AtlassianGuardError(
            f"BLOCKED: Jira project key {key!r} is not on this repo's read-only "
            f"allowlist {list(READ_ONLY_JIRA_PROJECT_KEYS)}.\n"
            f"Rollups/briefings may read KAN, RCP (recipe app) and PLZG, TO (plaza "
            f"game) on {ALLOWED_ATLASSIAN_SITE}. TOSVC is the frozen service-site "
            f"shell (SERVICE-HOLD — do not use) and is never valid."
        )

    raise AtlassianGuardError(
        f"BLOCKED: Jira project key {key!r} is not on this repo's write allowlist "
        f"{list(ALLOWED_JIRA_PROJECT_KEYS)}.\n"
        f"This repo's tooling may only file/update items in RCP (recipe app "
        f"releases) and KAN (recipe app tasks/bugs) on {ALLOWED_ATLASSIAN_SITE}.\n"
        f"PLZG and TO belong to the plaza game (different repo) and are readable "
        f"only via read_only=True rollup paths; TOSVC is the frozen service-site "
        f"shell (SERVICE-HOLD — do not use) and is never valid."
    )


def validate_jira_project_keys(keys: Iterable[str], *, read_only: bool = False) -> list[str]:
    """Validate every key in an iterable; returns the normalized list."""
    return [validate_jira_project_key(key, read_only=read_only) for key in keys]
