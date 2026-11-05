<script lang="ts">
  let { sprint, endsOn }: { sprint: string; endsOn: string } = $props();
</script>

<header class="board-header">
  <div>
    <h1>{sprint}</h1>
    <p class="meta">Ends {endsOn} · 18 of 26 points done</p>
  </div>
  <button class="complete-sprint" type="button">Complete sprint</button>
</header>

<style>
  .board-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
  }
  h1 {
    margin: 0;
  }
  .meta {
    margin: 4px 0 0;
    color: #5d6472;
  }
  .complete-sprint {
    padding: 8px 14px;
    border: none;
    border-radius: 6px;
    background: #4353c9;
    color: #fff;
  }
</style>
