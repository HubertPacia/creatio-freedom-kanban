# hp_kanban component

Angular 17 remote module with two Freedom UI view elements:

| Element | Type | Purpose |
|---|---|---|
| `hp-kanban-board` | `hp.KanbanBoard` | The board shown on the page |
| `hp-kanban-board-panel` | `hp.KanbanBoardPanel` | Its properties panel in the page designer |

- `src/app/board-logic.ts` - all pure logic (stages, filters, totals, sorting, lanes, record sync); checked by `src/app/board-logic.test.ts`.
- `src/app/view-elements/board/` - the board (data through `sdk.Model`, no OData).
- `src/app/view-elements/board-panel/` - the designer panel (`@creatio/interface-designer`).

```bash
npm ci
npm test        # node src/app/board-logic.test.ts -> "board-logic: ok"
npm run build   # -> ../packages/hpKanban/Files/src/js/hp_kanban
```

Keep `outputHashing: none`, `publicPath: auto` and the module name `hp_kanban` (webpack `name`/`uniqueName`, `bootstrapCrtModule`, the output folder): the Creatio shell finds the bundle by them. `lodash` is aliased to `lodash-es` in `webpack.config.js`, because the UMD build would overwrite the shell's global `_`.
