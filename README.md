# creatio-kanban

Kanban board widget for **Creatio Freedom UI**. Drop it onto any page from the page designer, then configure the stages and the objects (Tasks, Accounts, Cases, any object) that can be put on the board.

## Kanban board for Creatio (Freedom UI 8.x)

| Feature | Description |
|---|---|
| No-code widget | Shows up in the Freedom UI page designer under **Custom components → Kanban board**; everything is configured in the designer's right-hand panel |
| Your own stages | 1-12 stages with name, order and colour. Renaming a stage keeps its cards |
| Any object | Choose which objects' records may be put on a board (Activity, Account, Contact, Case, custom objects…) |
| Card layout | Per object, up to 8 fields on the card in any order, each with a Creatio icon and shown as a line (label: value), a tag, or the due date (a tag that turns amber when due soon, red when overdue); live preview in the settings; a colour per object |
| Column totals | Sum, average, minimum or maximum of one numeric field per board (e.g. Amount), filters respected |
| Drag and drop | Move cards between stages and reorder them, with a line showing where the card lands. A card moves at once and is saved in the background; if Creatio refuses the change it goes back and the message gives the stage, the field and Creatio's reason |
| Due dates | Show a date field as *Due* in the card layout and set its "due soon" days per object; filter *Due soon / overdue* |
| Locked objects | Per object, cards can be made unmovable (no drag and drop, no move actions) |
| Compact mode | One click shows titles only (remembered per user) |
| Card menu | ⋯ on every card: move to the previous / next stage, move up / down, scroll to bottom, history (keyboard friendly) |
| Record sync (optional) | Map each stage to one or more lookup values (e.g. Case → Status: *Open* = New, In progress). Moving a card sets the first value unless the record already has one of them; a record changed elsewhere moves its card |
| Stages from a field | *Create stages from Status values*: one stage per lookup value, mapped and coloured from the lookup |
| Auto-add (optional) | Every record with a mapped value lands in its stage by itself, e.g. all Cases with Status = In progress in "Doing"; the settings show how many records each value would add |
| Stage rules | Fields that must be filled before a card may enter a stage ("Fill Result details first") |
| Flow control | Card limit per stage (over-limit columns get red stripes), "stale after N days" marker, time in stage on every card |
| History | Every stage change is recorded (who, when, from, to); per-card history table |
| Swimlanes | Rows by owner or by object |
| Filters and toolbar | Search, object type, owner (list of owners on the board / me / no owner), "Stale only", due soon, sort. Each filter and each toolbar button (Compact, Refresh, Add card) can be switched off; users' choices are remembered per board |
| Team use | Quiet auto-refresh (default every 30 s), bulk add ("Add all matching"), collapsible columns |
| Copy settings | Export a board's settings as text and import them on another page |
| Automation | Every move is a record of `hpKanbanCardMove`, so any Creatio business process can react to "card entered stage X" |

No C#, no business processes, no compilation: the package contains two objects and a client-side Angular bundle.

## Requirements

- Creatio 8.x with Freedom UI. Built and tested on **10.1.796** (PostgreSQL).
- Package dependencies: `CrtBase`, `CrtUIv2`.

## Installation

1. Download `hpKanban.zip` from the latest [release](../../releases) (or from the repository root).
2. Install it:
   - **Application Hub** → **New application** → **Install from file** → select `hpKanban.zip`, or
   - with [clio](https://github.com/Advance-Technologies-Foundation/clio): `clio push-pkg hpKanban.zip -e <environment>`
3. Reload the browser (Ctrl+F5). No compilation or restart is needed.

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
  Files/app-descriptor.json       application name, developer and version shown in Application Hub
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

- A board loads at most 1000 cards; filtering is done in the browser.
- Refresh is polling (no server push).
- After upgrading the package, users may need a hard reload (Ctrl+F5): the bundle file names are fixed, so browsers can keep the old version.
- The board renders when its browser tab is visible (Angular custom elements update on animation frames, which browsers pause for hidden tabs).
