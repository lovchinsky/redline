<script lang="ts">
  import type { Task } from './tasks';

  let { task }: { task: Task } = $props();
</script>

<article class="task-card" class:is-bug={task.label === 'bug'}>
  {#if task.label}
    <span class="label label-{task.label}">{task.label}</span>
  {/if}
  <p class="task-title">{task.title}</p>
  <footer class="task-meta">
    <span class="avatar" title="Assignee">{task.assignee}</span>
    <span class="points" aria-label="Story points">{task.points} pts</span>
  </footer>
</article>

<style>
  .task-card {
    padding: 10px 12px;
    border-radius: 8px;
    background: #fff;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
  }
  .is-bug {
    border-left: 3px solid #d64545;
  }
  .label {
    font-size: 11px;
    text-transform: uppercase;
  }
  .task-title {
    margin: 4px 0 8px;
  }
  .task-meta {
    display: flex;
    justify-content: space-between;
    color: #5d6472;
    font-size: 12px;
  }
</style>
