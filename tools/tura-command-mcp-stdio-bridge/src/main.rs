use serde_json::{json, Value};
use std::env;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::time::Duration;

fn main() {
    let response = match run() {
        Ok(output) => json!({
            "ok": true,
            "success": true,
            "output": output,
            "stderr": "",
            "exit_code": 0
        }),
        Err(error) => json!({
            "ok": false,
            "success": false,
            "output": { "error": error },
            "stderr": "",
            "exit_code": 1
        }),
    };
    println!("{}", response);
}

fn run() -> Result<Value, String> {
    if !env::args().any(|argument| argument == "--protocol") {
        return Err("Tura MCP bridge requires --protocol".to_string());
    }
    let mut source = String::new();
    std::io::stdin()
        .read_to_string(&mut source)
        .map_err(|error| format!("failed to read Tura command envelope: {error}"))?;
    let envelope: Value = serde_json::from_str(source.trim())
        .map_err(|error| format!("invalid Tura command envelope: {error}"))?;
    if envelope.get("kind").and_then(Value::as_str) != Some("execute") {
        return Err("Tura MCP bridge only supports kind=execute".to_string());
    }
    let request = envelope
        .pointer("/payload/arguments")
        .cloned()
        .ok_or_else(|| "missing payload.arguments".to_string())?;
    let tool_name = request
        .get("name")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "missing payload.arguments.name".to_string())?;
    let tool_arguments = request
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    if !tool_arguments.is_object() {
        return Err("payload.arguments.arguments must be an object".to_string());
    }

    if let Ok(address) = env::var("TURA_MCP_BROKER_ADDR") {
        if !address.trim().is_empty() {
            return call_broker(&address, tool_name, tool_arguments);
        }
    }

    let command = required_env("TURA_MCP_SERVER_COMMAND")?;
    let args: Vec<String> = serde_json::from_str(&required_env("TURA_MCP_SERVER_ARGS_JSON")?)
        .map_err(|error| format!("invalid TURA_MCP_SERVER_ARGS_JSON: {error}"))?;
    let server_name = env::var("TURA_MCP_SERVER_NAME")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "task-mcp".to_string());
    let mut client = McpClient::start(&command, &args)?;
    client.request(
        "initialize",
        json!({
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {
                "name": "tura-command-mcp-stdio-bridge",
                "version": env!("CARGO_PKG_VERSION")
            }
        }),
    )?;
    client.notify("notifications/initialized", json!({}))?;
    let listed = client.request("tools/list", json!({}))?;
    let exists = listed
        .get("tools")
        .and_then(Value::as_array)
        .is_some_and(|tools| {
            tools
                .iter()
                .any(|tool| tool.get("name").and_then(Value::as_str) == Some(tool_name))
        });
    if !exists {
        return Err(format!(
            "MCP server {server_name} did not expose requested tool {tool_name}"
        ));
    }
    let result = client.request(
        "tools/call",
        json!({ "name": tool_name, "arguments": tool_arguments }),
    )?;
    if result.get("isError").and_then(Value::as_bool) == Some(true) {
        return Err(format!("MCP tool {tool_name} failed: {result}"));
    }
    Ok(result)
}

fn call_broker(address: &str, tool_name: &str, tool_arguments: Value) -> Result<Value, String> {
    let token = required_env("TURA_MCP_BROKER_TOKEN")?;
    let mut stream = TcpStream::connect(address)
        .map_err(|error| format!("failed to connect to MCP broker {address}: {error}"))?;
    let timeout = Some(Duration::from_secs(120));
    stream
        .set_read_timeout(timeout)
        .and_then(|_| stream.set_write_timeout(timeout))
        .map_err(|error| format!("failed to configure MCP broker socket: {error}"))?;
    writeln!(
        stream,
        "{}",
        json!({
            "token": token,
            "name": tool_name,
            "arguments": tool_arguments
        })
    )
    .and_then(|_| stream.flush())
    .map_err(|error| format!("failed to send MCP broker request: {error}"))?;

    let mut line = String::new();
    BufReader::new(stream)
        .read_line(&mut line)
        .map_err(|error| format!("failed to read MCP broker response: {error}"))?;
    if line.trim().is_empty() {
        return Err("MCP broker closed without a response".to_string());
    }
    let response: Value = serde_json::from_str(line.trim())
        .map_err(|error| format!("invalid MCP broker response: {error}"))?;
    if response.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(response
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("MCP broker request failed")
            .to_string());
    }
    response
        .get("result")
        .cloned()
        .ok_or_else(|| "MCP broker response had no result".to_string())
}

fn required_env(name: &str) -> Result<String, String> {
    env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("missing {name}"))
}

struct McpClient {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
}

impl McpClient {
    fn start(command: &str, args: &[String]) -> Result<Self, String> {
        let mut child = Command::new(command)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("failed to start MCP server {command}: {error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "MCP server stdin was unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "MCP server stdout was unavailable".to_string())?;
        Ok(Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            next_id: 1,
        })
    }

    fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        self.send(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        }))?;
        loop {
            let mut line = String::new();
            let bytes = self
                .stdout
                .read_line(&mut line)
                .map_err(|error| format!("failed to read MCP {method} response: {error}"))?;
            if bytes == 0 {
                return Err(format!("MCP server closed stdout during {method}"));
            }
            let response: Value = serde_json::from_str(line.trim())
                .map_err(|error| format!("invalid MCP response during {method}: {error}"))?;
            if response.get("id").and_then(Value::as_u64) != Some(id) {
                continue;
            }
            if let Some(error) = response.get("error") {
                return Err(format!("MCP {method} returned error: {error}"));
            }
            return response
                .get("result")
                .cloned()
                .ok_or_else(|| format!("MCP {method} response had no result"));
        }
    }

    fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        self.send(&json!({ "jsonrpc": "2.0", "method": method, "params": params }))
    }

    fn send(&mut self, value: &Value) -> Result<(), String> {
        writeln!(self.stdin, "{}", value)
            .and_then(|_| self.stdin.flush())
            .map_err(|error| format!("failed to write MCP request: {error}"))
    }
}

impl Drop for McpClient {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
