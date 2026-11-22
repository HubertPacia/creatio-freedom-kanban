# creatio-kanban

Kanban board widget for **Creatio Freedom UI**. Drop it onto any page from the page designer, then configure the stages and the objects (Tasks, Accounts, Cases, any object) that can be put on the board.

## Kanban board for Creatio (Freedom UI 8.x)

| Feature | Description |
|---|---|
| No-code widget | Shows up in the Freedom UI page designer under **Custom components → Kanban board**; everything is configured in the designer's right-hand panel |
| Your own stages | 1-12 stages with name, order and colour. Renaming a stage keeps its cards |
| Any object | Choose which objects' records may be put on a board (Activity, Account, Contact, Case, custom objects…) |
| Cards | Up to 4 fields per object shown on the cards (dates, lookups, numbers, text), a colour per object |
| Column totals | Sum of a numeric field per stage (e.g. Amount), filters respected |
| Drag and drop | Move cards between stages and reorder them; ← / → buttons for keyboard users |
| Record sync (optional) | Map each stage to a lookup value (e.g. Activity → Status). Moving a card updates the record; a record changed elsewhere moves its card |
| Stage rules | Fields that must be filled before a card may enter a stage ("Fill Result details first") |
| Flow control | Card limit per stage (over-limit columns get red stripes), "stale after N days" marker, time in stage on every card |
| History | Every stage change is recorded (who, when, from, to); per-card history table |
| Swimlanes | Rows by owner or by object |
| Filters | Search, object type, owner (list of owners on the board / me / no owner), "Stale only", sort. Each filter can be switched off; users' choices are remembered per board |
| Team use | Quiet auto-refresh (default every 30 s), bulk add ("Add all matching"), collapsible columns |
| Automation | Every move is a record of `hpKanbanCardMove`, so any Creatio business process can react to "card entered stage X" |

No C#, no business processes, no compilation: the package contains two objects and a client-side Angular bundle.

## Requirements

- Creatio 8.x with Freedom UI. Built and tested on **10.1.796** (PostgreSQL).
- Package dependencies: `CrtBase`, `CrtUIv2`.

## Installation

1. Download `hpKanban.gz` from the latest [release](../../releases) (or take it from the repository root).
2. Install it:
   - **Application Hub** → **New application** → **Install from file** → select `hpKanban.gz`, or
   - with [clio](https://github.com/Advance-Technologies-Foundation/clio): `clio push-pkg hpKanban.gz -e <environment>`
3. Reload the browser (Ctrl+F5). No compilation or restart is needed.

## Quick start

1. Open any Freedom UI page in the page designer (gear icon → *Open page designer*, or *Application Hub* → your app → page).
2. In **Components**, search for **Kanban board** (group *Custom components*) and drag it onto the page.
3. Select the widget (click it, or pick it in the **Structure** tab) and expand the right panel. The panel gives the board its own id the first time it opens.
4. Set the title, the stages and the allowed objects, then **Save** the page.
5. Open the page, click **+ Add card**, pick an object and a stage, search a record and add it.

## Configuration (designer → right panel)

### General
- **Title**, **Height** (`600px`, `70vh`, `calc(100vh - 160px)` …)
- **Swimlanes** - none, by owner, by object
- **Refresh every (seconds)** - quiet reload while the board is visible; `0` turns it off

### Filters on the board
Tick which controls users see: search box, object type, owner, "Stale only", sort order. A switched-off filter is hidden and stops filtering.

### Stages
Each stage is one row (colour dot, name, move left/right, remove) with a one-line summary such as `limit 8 · stale 3 d · 1 rule`. Click the summary to open it:
- **Colour** - one of 8 swatches or none
- **Card limit** - the header shows `count / limit`; amber at the limit, red badge and red stripes at the bottom of the column above it (moves stay allowed)
- **Stale after N days** - older cards get a "stale" label; filter *Stale only*
- **Required before a card may enter this stage** - per object, fields that must be filled (chips; *+ field* adds one)

### Cards and totals (per allowed object)
- **Fields on the card** - up to 4 columns
- **Total field** - a numeric column summed per stage (values of different objects are added together, so use one currency/unit per board)
- **Update a record field when the card changes stage** - tick it, choose a lookup field of the object, then map each stage to a value in the table (*don't change* leaves the record alone)
- **Card colour**

### Allowed objects
A searchable table of all objects; ticked objects can be put on the board.

## Using the board

- **Add card** - choose object and stage, search by the object's display column, *Add*. **Add all matching (n)** adds every match (up to 100); records already on the board are skipped and stage rules apply to each one.
- **Move** - drag and drop, or the ← / → buttons. In a sorted view (title, total, newest) dragging only changes the stage; choose *Manual order* to reorder.
- **Open** - click the card title to open the record's own form page.
- **Remove** - × takes the card off the board; the record itself is never deleted.
- **History** - table of the card's moves (`dd.mm.yy HH:mm`, who, from, to).
- **Collapse** - click a stage name to collapse the column (remembered in the browser).

## Record sync and automation

**Record sync.** With a field mapped (e.g. Activity → Status: *To do* = Not started, *Doing* = In progress, *Done* = Completed), moving a card first updates the record and then the card; if Creatio refuses the update (rights, business rules) the card stays and the message is shown. When the field is changed anywhere else, the card moves to the first stage mapped to the new value on the next load or refresh.

**Automation - "when a card enters stage X, do Y".** Every add and every stage change writes one `hpKanbanCardMove` record. Create a business process with:
1. Start event **Signal** → object *Kanban card move* → **Record added**, filtered by `Board code` = the board's code and `To stage code` = the stage id.
2. *Read data* on the object named in `Object name` with `Id` = `Record Id`.
3. Any actions you need (create a task, send an email, update a field …).

The board code and the stage ids are visible in the page schema (`boardCode`, `stages[].id` of the `hp.KanbanBoard` element).

## Data model

| Object | Column | Type | Meaning |
|---|---|---|---|
| `hpKanbanCard` (Kanban card) | `hpBoardCode` | Text (50) | Board the card belongs to |
| | `hpStageCode` | Text (50) | Stage id (stable when the stage is renamed) |
| | `hpEntityName` | Text (250) | Object name, e.g. `Activity` |
| | `hpRecordId` | Guid | The record on the card |
| | `hpPosition` | Integer | Order within the stage |
| | `hpStageChangedOn` | Date/time | When the card entered its stage |
| `hpKanbanCardMove` (Kanban card move) | `hpBoardCode`, `hpEntityName`, `hpRecordId` | | Which card |
| | `hpFromStageCode` / `hpToStageCode` | Text | Stage ids (`from` empty for an add) |
| | `hpFromStageCaption` / `hpToStageCaption` | Text | Stage names at the time of the move |
| | `CreatedBy`, `CreatedOn` | | Who and when |

The board's configuration (stages, objects, rules, filters) lives in the page schema as properties of the widget; only card positions and history are records.

## Build from source

```
component/                        Angular 17 remote module (source)
packages/hpKanban/
  descriptor.json                 package name, dependencies (CrtBase, CrtUIv2)
  Schemas/hpKanbanCard/           object: card positions
  Schemas/hpKanbanCardMove/       object: move history
  Resources/                      object captions (en-US)
  Files/src/js/hp_kanban/         built widget bundle (output of component/)
hpKanban.gz                       installable package archive
```

The empty `hpKanbanCard.cs` / `hpKanbanCardMove.cs` files are part of Creatio's package file format: the platform writes one next to every object schema (objects have no C# code of their own), and re-creates them on every export.

```bash
cd component
npm ci
npm test          # board logic self-check (Node 22.6+), prints "board-logic: ok"
npm run build     # writes the bundle to ../packages/hpKanban/Files/src/js/hp_kanban
```

Install the package from the folder with `clio push-pkg packages/hpKanban -e <environment>`, or build the archive with `clio generate-pkg-zip hpKanban -d hpKanban.gz` (run in `packages/`).

The widget uses `@creatio-devkit/common` and `@creatio/interface-designer` 0.1000.3 (the designer properties panel API).

## Limitations and notes

- The widget appears in the designer's **Custom components** group; the platform API does not allow adding it to the built-in *Widgets* group.
- A board loads at most 1000 cards; filtering is done in the browser.
- Refresh is polling (no server push).
- After upgrading the package, users may need a hard reload (Ctrl+F5): the bundle file names are fixed, so browsers can keep the old version.
- The board renders when its browser tab is visible (Angular custom elements update on animation frames, which browsers pause for hidden tabs).
