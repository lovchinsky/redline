<script lang="ts">
  let { onadd }: { onadd: (title: string) => void } = $props();
  let title = $state('');

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (title.trim() === '') return;
    onadd(title.trim());
    title = '';
  }
</script>

<form class="add-task" onsubmit={submit}>
  <input bind:value={title} placeholder="Add a task…" aria-label="New task title" />
  <button type="submit">Add</button>
</form>

<style>
  .add-task {
    display: flex;
    gap: 6px;
  }
  input {
    flex: 1;
  }
</style>
