<script lang="ts">
  import TaskCard from './TaskCard.svelte';
  import AddTaskForm from './AddTaskForm.svelte';
  import type { Task } from './tasks';

  let { title, tasks, onadd }: { title: string; tasks: Task[]; onadd: (title: string) => void } =
    $props();
</script>

<section class="column">
  <h2 class="column-title">
    {title}
    <span class="count">{tasks.length}</span>
  </h2>
  <ul class="cards">
    {#each tasks as task (task.id)}
      <li><TaskCard {task} /></li>
    {/each}
  </ul>
  <AddTaskForm {onadd} />
</section>

<style>
  .column {
    padding: 12px;
    border-radius: 10px;
    background: #f8f9fb;
  }
  .column-title {
    display: flex;
    justify-content: space-between;
    margin: 0 0 12px;
    font-size: 14px;
    text-transform: uppercase;
  }
  .count {
    color: #8b93a3;
  }
  .cards {
    display: grid;
    gap: 8px;
    margin: 0 0 12px;
    padding: 0;
    list-style: none;
  }
</style>
