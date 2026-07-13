# /agent-designer i need too triage and fix a problem with my JIRA and Confluence s>

## What there is now:
        - Two seperate projects:
                1. recipe app: tasteslikegood.org
                2. 10110 TLG plaza office 'game'.
        - Two seperate atlassian urls:
                1. tasteslikegood-dev.atlassian.net = service spaces (user/public f>
                2. tasteslikegood.atlassian.net = software spaces and delivery spac>
                        - Recipe Delivery = RCP (company managed software space)   >
                        - Recipe Task tracking = KAN (team-managed software space) >
                        - Office Delivery = PLZG (Company managed software space) u>
                        - 10110 Tasteslikegood Plaza = TO (Team-managed business sp>
                3. **tasteslikegood-dev.atlassian.net:
                        - Tasteslikegood.org = TO (Team-managed buiness space)*** u>

### The Obvious (now that i see it) problem: both tasteslikegood.atlassian.net and >

### The 'rest': All five spaces have mixed work items for both the recipe project R>

### the cause, beside the TO double spaces: scripts/pm was pointed at the '-dev' si>
    the exact cause is not impoatant as it is


i need too triage and fix a problem with my JIRA and Confluence sites:

## What there is now:
        - Two seperate projects:
                1. recipe app: tasteslikegood.org
                2. 10110 TLG plaza office 'game'.
        - Two seperate atlassian urls:
                1. tasteslikegood-dev.atlassian.net = service spaces (user/public facing for issues and tickets)
                2. tasteslikegood.atlassian.net = software spaces and delivery spaces
                        - Recipe Delivery = RCP (company managed software space)   url: https://tasteslikegood.atlassian.net/jira/software/c/projects/RCP/boards/168?atlOri>
                        - Recipe Task tracking = KAN (team-managed software space) url: https://tasteslikegood.atlassian.net/jira/software/projects/KAN/boards/34?atlOrigin>
                        - Office Delivery = PLZG (Company managed software space) url: https://tasteslikegood.atlassian.net/jira/software/c/projects/PLZG/boards/167?atlOri>
                        - 10110 Tasteslikegood Plaza = TO (Team-managed business space) *** url: https://tasteslikegood.atlassian.net/jira/core/projects/TO/board?filter=&g>
                3. **tasteslikegood-dev.atlassian.net:
                        - Tasteslikegood.org = TO (Team-managed buiness space)*** url: https://tasteslikegood-dev.atlassian.net/jira/core/projects/TO/board?filter=&groupBy>

### The Obvious (now that i see it) problem: both tasteslikegood.atlassian.net and *-dev.atlassian.net sites have a team managed buiness space with the KEY = TO

### The 'rest': All five spaces have mixed work items for both the recipe project RCP/KAN and the PLZG plaza game project.

### the cause, beside the TO double spaces: scripts/pm was pointed at the '-dev' site until the updates this week. Also the keys were mixed up...
    the exact cause is not impoatant as long as it is not persisitng.

## Goal: The '-dev' site should be set up (with unique keys) as a public facing service site as it is intended. Not important for this scope - what is is the dev- TO needs>
temporarily while we verify there is not items there for either project that are not in the Delivery site spaces. Setting up service spaces scafold only would help visably
differentiate the sites, but beyond that is outside the scope of this **Critical Chore/task/Milestone**.
        The remainder of the goal is too seperate the items for the two projects so the 4 tasteslikegood.atlassian.net sites mentioned are serving the purposes they are in>

#### Sub-tasks/sanity checks: (each of these should be delegated to a sub-agent)
        - Check/update the description/landing page for the sw and delivery spaces so that it is clear to any man/agent/machine/itern/9 yr old gamer what they're for
        - Check/update the scripts/pm files to make sure they're not going to do this again (since they live in the recipe repo they shouldnt touch the PLZG and TO spaces)
        - Check and update the docs (this might need to be delegated into multiple sub-tasks/agents):
                - scripts/pm docs
                - CLAUDE.md and AGENTS.md and other agent intructions
                - README.md
                - .env.example
                - doc/<appropriate docs> 
