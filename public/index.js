let socket
let connected = false
let connecting = false

const ScreenElement = document.querySelector("#screen")
const serverUrlElement = document.querySelector("#serverUrl")
const usernameBox = document.querySelector("#username")
const msgBox = document.querySelector("#msgbox");

/*
	what do we even need to do
	- connection system (connect to server)
	- channel system (handle channels)

*/

const allowedElements = ["B", "I", "U", "IMG", "STRONG", "EM", "P", "A", "VIDEO", "AUDIO", "SOURCE", "BR"]

serverUrlElement.value = `${window.location.protocol.startsWith("https") ? "wss" : "ws"}://${window.location.host}`

const statusspan = document.getElementById("status")
function setStatus(status){
	statusspan.innerHTML = status
}

function addMsgElement(name, content, timestamp){
	let li = document.createElement("li")
	let infoP = document.createElement("p")
		let nameSpan = document.createElement("span")
			nameSpan.className = "bold username"
		let dateSpan = document.createElement("span")
		infoP.appendChild(nameSpan)
		infoP.appendChild(dateSpan)
	let messageP = document.createElement("p")
		messageP.className = "messagecontent"
	li.appendChild(infoP)
	li.appendChild(messageP)

	messageP.innerHTML = content
	function checkForXSS(element){
		for(x of Array.from(element.children)){
			//for every child
			x.className = "nopadding"
			//check if the element is not allowed
			//find an element where the element matches something from the allowed list
			let allowed = allowedElements.find(element => element === x.tagName)
			if(allowed === undefined){
				//is not allowed
				//remove it
				element.removeChild(x);
			} else {
				checkForXSS(x);
			}
		}
	}
	checkForXSS(messageP);
	nameSpan.innerHTML = name
	let date = new Date(timestamp)
	dateSpan.innerHTML = date.toLocaleString()
	//li.id = id.toString()
	msgList.appendChild(li);
	ScreenElement.scrollTop = li.offsetTop;
}

function sendSystemMessage(message){
	addMsgElement("System", message, Date.now())
}

function connect(){
	if(connected){
		sendSystemMessage("Failed to connect: Already connected")
		return
	}
	if(connecting){
		return
	}
	if(usernameBox.value === ""){
		sendSystemMessage("Failed to connect: Blank username")
		return
	}
	connecting = true
	let serverUrl = serverUrlElement.value
	sendSystemMessage(`Opening connection to ${serverUrl}...`)
	setStatus("connecting...")
	socket = io(serverUrl, {
		reconnection: false
	})
	console.log(socket)
	// set connect timer to 5 seconds
	socket._connectTimer = setTimeout(() => {
		socket.close();
		sendSystemMessage(`Failed to connect: timed out`)
		setStatus("failed to connect")
		connecting = false
	}, 5000);

	socket.on('connect', function() {
		// socket connected successfully, clear the timer
		clearTimeout(socket._connectTimer);
		connected = true
		sendSystemMessage("Connected")
		setStatus("connected")
		connecting = false
		socket.emit("assignUsername", usernameBox.value)
	});

	socket.on("disconnect", reason => {
		console.log(`disconnected from server: ${reason}`)
		//disconnected manually or lost connection
		//determine that
		setStatus("disconnected")
		if(connected){
			//we didnt disconnect manually
			sendSystemMessage(`Lost connection to server, reason: ${reason}`)
		} else {
			//we disconnected manually
			sendSystemMessage("Disconnected from server")
		}
		connected = false
	})

	socket.on("msg", (data) => {
		addMsgElement(data.username, data.content, new Date())
	})

	socket.on("systemMessage", (message) => {
		sendSystemMessage(`SERVER: ${message}`)
	})
}

const commands = [
	{
		name: "/list",
		description: "Show all channels",
		aliases: [],
		run: () => {
			if(!connected){
				sendSystemMessage("Failed to get channel list: Not connected")
				return
			}
			socket.emit("getChannels")
		}
	},
	{
		name: "/channel",
		description: "Set the current channel",
		aliases: [],
		run: (args) => {
			if(!connected){
				sendSystemMessage("Failed to switch channel: Not connected")
				return
			}
			let channel = args[0]
			if(channel === "" || channel === undefined){
				sendSystemMessage("Failed to switch channel: No channel specified")
				return
			}
			sendSystemMessage(`Setting channel to ${channel}...`)
			socket.emit("switchChannel", channel)
		}
	},
	{
		name: "/cmds",
		description: "Shows a list of all commands",
		aliases: ["commands", "help"],
		run: () => {
			/*
			let cmds = []
			commands.forEach((command) => {
				let aliasestbl = []
				for(x of command.aliases){
					aliasestbl.push(`/${x}`)
				}
				cmds.push(`${command.name} [${aliasestbl.join(", ")}]`)
			})
			sendSystemMessage(cmds.join(", "));
			*/
			page = `COMMANDS<br>`
			commands.forEach(command => {
				page += `<br>${command.name}<br>Aliases: ${command.aliases.join(", ")}<br>Description: ${command.description}<br>`
			})
			sendSystemMessage(page)
		}
	},
	{
		name: "/members",
		aliases: ["getmembercount", "count", "members", "getcount"],
		description: "Get users in the channel",
		run: () => {
			if(!connected){
				sendSystemMessage("Failed to get channel members: Not connected")
				return
			}
			socket.emit("usersInChannel")
		}
	},
]

function sendMessage(){
	//get content
	let content = msgBox.value
	if(content === ""){
		return
	}
	//check if its a command
	let command = null
	for(let x of commands){
		if(content.startsWith(x.name)){
			command = x
		} else {
			for(alias of x.aliases){
				if(content === `/${alias}`){
					command = x
				}
			}
		}
	}
	if(command !== null){
		//if such command exists
		//run it
		//parse args
		//command is content
		let args = content.split(" ").slice(1);
		console.log(args)
		//let cmdNoPrefix = message.content.split(" ")[0].replace(config.prefix, "");
		//let commandToExec = commands.get(cmdNoPrefix);
		//if(commandToExec && commandToExec.help.enabled === true) await commandToExec.run(bot, message, args, commands);
		command.run(args, content);
		msgBox.value = ""
	} else {
		//check if connected
		/*
		if(connected === false){
			alert("Not connected");
			return
		}
		*/
		//send
		msgBox.value = ""
		socket.emit("sendMessage", content)
	}
}

function disconnect(){
	if(!connect){
		sendSystemMessage("Failed to disconnect: Already disconnected")
		return
	}
	if(connecting){
		//TODO: stop the connection?
		sendSystemMessage("Failed to disconnect: Connecting in progress.")
		return
	}
	//we are connected
	//stop the connection
	connected = false
	socket.close()
}

msgBox.addEventListener("keypress", (event) => {
	if (event.key === "Enter") {
		event.preventDefault();
		document.getElementById("sendMessageButton").click();
	}
})
