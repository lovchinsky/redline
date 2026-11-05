<script lang="ts">
  import BoardHeader from './lib/BoardHeader.svelte';
  import Column from './lib/Column.svelte';
  import { initialTasks, type ColumnId } from './lib/tasks';

  let tasks = $state(initialTasks);
  const columns: { id: ColumnId; title: string }[] = [
    { id: 'todo', title: 'To do' },
    { id: 'doing', title: 'In progress' },
    { id: 'done', title: 'Done' },
  ];

  function addTask(column: ColumnId, title: string) {
    tasks = [...tasks, { id: tasks.length + 1, title, assignee: '—', points: 1, column }];
  }
</script>

<main class="board">
  <BoardHeader sprint="Sprint 24" endsOn="Nov 14" />
  <div class="columns">
    {#each columns as column (column.id)}
      <Column
        title={column.title}
        tasks={tasks.filter((task) => task.column === column.id)}
        onadd={(title) => addTask(column.id, title)}
      />
    {/each}
  </div>
</main>

<style>
  .board {
    padding: 24px;
  }
  .columns {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }
</style>
