# BDSL Stats — A Proposal for Making It Permanent

## Summary

BDSL Stats is a website that collects every result and player statistic the league publishes and
turns it into season standings, player pages, club histories, records, and championship history
going back to 2008. It updates itself automatically every couple of days during the season, and it
costs nothing to run.

It works. The question this document answers is a different one: **what would it take for the league
to rely on it for the next ten years, no matter who is or isn't around to look after it?**

The short answer is that it needs three things — a web address of its own, ownership in the league's
name rather than one person's, and a handful of changes so it keeps updating itself without anyone
tending to it. Total recurring cost: about **$15 a year**.

---

## 1. Where things stand today

The site is live and working. Every couple of days it re-reads the league's published results,
recalculates everything, and republishes itself. Nobody logs in. Nobody presses a button. Nobody
uploads a file.

Two things about it are not yet ready for league-wide promotion:

- **It lives at a personal web address.** That's fine for passing around informally. It's not what
  you'd want printed on a league page, and it ties the site's identity to one person.
- **Its automatic updating has a quiet expiration date.** More on this in section 4 — it's the most
  important item in this document, and the least visible.

Everything else — the hosting, the automatic updates, the historical data — is already stable and
already free.

---

## 2. A web address of its own

The league's current web address is managed by the company that provides the league's main website,
so an address underneath it likely isn't available to us. The straightforward path is to register a
new, short address just for the stats site and link to it from the league's main page.

**Cost: roughly $12–15 per year.** That is the only recurring expense anywhere in this proposal.
There is no hosting bill, now or later.

**Recommendation: the league should register and pay for it, not an individual.** Turn on
auto-renewal, put a league payment method on file, and store the login wherever the league keeps its
other accounts. A registration that quietly lapses because it was on a former volunteer's personal
credit card is the single most common way a project like this disappears — and when it happens, the
site goes dark with no warning and no easy way back.

---

## 3. Putting the project in the league's name

Right now the whole project sits in one person's personal account. That means if that person becomes
unavailable, nobody can hand it to a new volunteer, fix a problem, or even grant someone else
permission to try.

The fix is simple and free: create a **league-owned account** on GitHub, the service that already
hosts the site, and move the project into it. Two league officers hold the keys. The current
maintainer stays on with full working access and keeps improving the site as they do now.

What this buys the league:

- The league can hand the project to a new volunteer at any time, without needing to track down the
  original author.
- Nothing breaks and nothing is lost if the current maintainer steps away.
- The existing address keeps working after the move — no broken links.
- It remains free. There is no paid tier involved at any point.

To be clear about what this does *not* mean: nobody at the league has to learn to operate anything.
Holding the keys means being able to let someone else in. That's the whole job.

---

## 4. Keeping it updating on its own

This is the part that matters most, because it's the part that would fail silently.

**The problem.** The service that runs the automatic updates switches off unattended scheduled jobs
after roughly two months if nobody has actively worked on the project. That's a deliberate policy on
their end, meant to stop abandoned projects from running forever. The updates the site makes to
itself don't count as "activity" for this purpose — only a person working on it does. So as things
stand, if the maintainer takes a few months off, the stats quietly stop refreshing. The site stays
up. It just stops being current, and nobody is told.

**Two changes fix this permanently:**

**A refresh that doesn't expire.** There is a different, non-expiring form of permission the project
can use for its automatic updates, which removes the two-month shutoff entirely. It's a one-time
setup that is never revisited afterward — no annual renewal, no password to rotate, nothing on
anyone's calendar.

**Separating the numbers from the website.** Today, new statistics can only reach the site by
rebuilding the entire website from scratch. That rebuild relies on a stack of general-purpose
software tools that go out of date on their own schedule — and eventually one of them will stop
working, which would take the statistics down with it. Publishing the numbers separately from the
website means the two no longer depend on each other: the stats keep flowing even if the
website-building machinery goes stale, and the website only gets rebuilt when someone actually
changes the site itself. This is the change most likely to matter in year five.

Both are invisible to anyone using the site. Both are done once.

---

## 5. What a non-technical person would actually have to do

Worth stating plainly up front: **updating and publishing are already fully automatic.** There is no
routine task. Nobody logs in to post results. The site does not need a webmaster.

There are exactly three things a human is ever needed for, and the proposal includes making each one
easier:

**Once a year, at the start of a new season.** The league's website reorganizes for each new season,
and the project has to be pointed at the new season's pages. Today that means editing a code file —
realistically a job for someone technical. The proposal is to move that setting into a simple
fill-in-the-blank file that can be edited directly in a web browser, with written step-by-step
instructions for finding the handful of values it needs. Target: about fifteen minutes, once a year,
for someone willing to follow instructions carefully.

**Occasionally, restarting an update that failed.** The league's site is sometimes briefly
unavailable, and an update can fail for that reason. There is already a single button that re-runs
it; the instructions will say exactly where to find it. This is rare.

**Noticing when something has stopped.** Right now, a failed update notifies essentially one person.
The proposal adds two safeguards: a failure automatically posts a visible notice that reaches
everyone watching the project, and the site itself displays a plain warning banner when its numbers
are more than a few days old. The goal is that a stall is obvious to everyone rather than to nobody.

**Plus a one-page instruction sheet** covering exactly these three tasks, written for someone with
no technical background, kept alongside the project so it can't be misplaced.

---

## 6. What it costs

| Item | Cost |
|---|---|
| Web address (registration, annual) | ~$12–15 / year |
| League-owned account | Free |
| Website hosting | Free |
| Automatic data updates | Free |
| **Total recurring** | **~$15 / year** |

There is no scenario in this proposal where the league receives a hosting bill. The web address is
the only thing anyone ever pays for.

**Effort.** The league's part is two short administrative tasks — registering an address and setting
up an account. The technical work is a few evenings for the current maintainer, and it's the kind of
work that is done once and then left alone.

---

## 7. Suggested order

| # | Step | Who |
|---|---|---|
| 1 | Decide on and register a web address, with auto-renewal on a league payment method | League |
| 2 | Create the free league-owned account; name two officers on it | League |
| 3 | Move the project into the league account and connect the new address | Both |
| 4 | Make the automatic updates non-expiring | Maintainer |
| 5 | Separate the statistics from the website rebuild | Maintainer |
| 6 | Simplify the once-a-year season setup; add failure notices and the stale-data warning | Maintainer |
| 7 | Write the one-page instruction sheet | Maintainer |
| 8 | Announce it and link it from the league's main site | League |

Steps 1 through 5 are what should happen before promoting the site league-wide. Steps 6 and 7 make
it survivable long-term and can follow shortly after.

---

## What the league is being asked to decide

1. Whether to fund a web address at roughly $15 a year.
2. Whether to create a free league-owned account and have the project moved into it.
3. Who the two officers on that account should be.

Everything else on this list is work the current maintainer will do regardless. The purpose of these
three decisions is narrower than it might look: they're what make the site the league's asset rather
than one volunteer's side project — so that ten years from now it's still there, still current, and
still handed cleanly to whoever wants to look after it next.
