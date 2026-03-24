// Redirect console.debug/info/log to stderr so they don't pollute
// the JSON-RPC stdio channel used by claude-code-acp.
// The bridge's actual JSON-RPC output uses process.stdout.write()
// directly and is unaffected by this patch.
console.debug = console.error;
console.info = console.error;
console.log = console.error;
