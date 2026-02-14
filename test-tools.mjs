import('./mcp/tools.js').then(m => {
  const tools = m.getTools();
  console.log('Total tools:', tools.length);
  const flowTools = tools.filter(t => t.name.startsWith('flow_'));
  console.log('Flow tools count:', flowTools.length);
  console.log('Flow tool names:', flowTools.map(t => t.name));
});
