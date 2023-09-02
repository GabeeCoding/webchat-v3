let socket
let connected = false
let connecting = false

const ScreenElement = document.querySelector("#screen")
const serverUrlElement = document.querySelector("#serverUrl")
const usernameBox = document.querySelector("#username")
const msgBox = document.querySelector("#msgbox");

const allowedElements = ["B", "I", "U", "IMG", "STRONG", "EM", "P", "A", "VIDEO", "AUDIO", "SOURCE", "BR"]

serverUrlElement.value = `${window.location.host}`

const statusspan = document.querySelector("#status")
function setStatus(status){
	statusspan.innerHTML = status
}

function addMsgElement(name, content, timestamp){
	let li = document.createElement("li")
	let infoP = document.createElement("p")
		let nameSpan = document.createElement("span")
			nameSpan.className = "bold username"
		let dateSpan = document.createElement("span")
			dateSpan.className = "msgDate"
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

//AES-256
const keySize = 256
function generateAESKey(){
	const key = CryptoJS.lib.WordArray.random(keySize / 8)
	const keyHex = key.toString(CryptoJS.enc.Hex)
	return keyHex
}

async function connect(){
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

	function close(){
		if(socket) socket.close()
		connecting = false
		setStatus("connection terminated")
	}

	let serverUrl = serverUrlElement.value
	sendSystemMessage(`Opening connection to ${serverUrl}...`)


	let AESKey = generateAESKey()
	const decrypt = encrypted => {
		return CryptoJS.AES.decrypt(encrypted, AESKey).toString(CryptoJS.enc.Utf8)
	}

	sendSystemMessage("Generated AES key.")
	const encrypt = text => {
		return CryptoJS.AES.encrypt(text, AESKey).toString()	
	}
	window.encrypt = encrypt

	sendSystemMessage("Initiating secure handshake.")

	//get pubkey and sum
	let serverPublicKey

	try {
		let url = `http://${serverUrl}/publickey`
		console.log(url)
		let resp = await fetch(url)
		if(resp.ok){
			let body = await resp.text()
			//body is public key
			serverPublicKey = body
		} else {
			console.error("resp not ok")
			sendSystemMessage("ERROR: Couldn't get server public key. Terminating connection...")
			close()
			return
		}
	} catch (err) {
		console.error(err)
		sendSystemMessage(`ERROR: Couldn't get server public key. Terminating connection... <br><br>Debug log:<br>${err.stack.replace("\n", "<br>")}`)
		close()
		return
	}

	sendSystemMessage("Successfully got server public key.")

	let serverPublicKeyChecksum

	try {
		let url = `http://${serverUrl}/publickeychecksum`
		console.log(url)
		let resp = await fetch(url)
		if(resp.ok){
			let body = await resp.text()
			//body is public key checksum
			serverPublicKeyChecksum = body
		} else {
			console.error("resp not ok")
			sendSystemMessage("ERROR: Couldn't get server public key checksum. Terminating connection...")
			close()
			return
		}
	} catch (err) {
		console.error(err)
		sendSystemMessage(`ERROR: Couldn't get server public key checksum. Terminating connection... <br><br>Debug log:<br>${err.stack.replace("\n", "<br>")}`)
		close()
		return
	}

	sendSystemMessage(`Public key checksum is ${serverPublicKeyChecksum}`)
	//calculate checksum ourselves
	let calculatedChecksum = CryptoJS.SHA256(serverPublicKey).toString(CryptoJS.enc.Hex)
	if(calculatedChecksum !== serverPublicKeyChecksum){
		sendSystemMessage("WARNING: THERE IS A STRONG CHANCE SOMEONE HAS INTERCEPTED THE CONNECTION")
		sendSystemMessage("WARNING: Server and local checksum do not match.")
		console.error("server public key checksum", serverPublicKeyChecksum)
		console.error("local public key checksum", calculatedChecksum)
		console.error("public key from server:")
		console.error(serverPublicKey)
		sendSystemMessage("Will not continue. Terminating connection...")
		close()
		return
	} else {
		sendSystemMessage("Checksums are ok.")
	}

	//encrypt our AES key with the servers public key
	let encryptor = new JSEncrypt()
	encryptor.setPublicKey(serverPublicKey)

	let encryptedAESKey = encryptor.encrypt(AESKey)
	
	//how does the server securely send data to client? client dont have public key, only AES key
	//encrypt with aes key, TODO, find out security complications with this
	
	//fetch(`${serverUrl}/connect`, {method: "POST", body: AESKey})

	//console.log(CryptoJS.AES.decrypt(encrypted, AESKey).toString(CryptoJS.enc.Utf8))

	//setStatus("connecting...")
	sendSystemMessage("Connecting to socket server...")
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
	
	socket.on("decryptKeyFailed", () => {
		sendSystemMessage("ERROR: The server failed to decrypt the AES key. Terminating connection...")
		close()
	})

	socket.on("keyDecrypted", () => {
		sendSystemMessage("Server successfully decrypted AES key.")
		//assign username
		socket.emit("assignUsername", encrypt(usernameBox.value))
	})

	socket.on('connect', () => {
		// socket connected successfully, clear the timer
		clearTimeout(socket._connectTimer);
		connected = true
		sendSystemMessage("Connected to socket server.")
		setStatus("connected")
		connecting = false
		sendSystemMessage("Sending encrypted AES key to server...")
		socket.emit("encryptedKey", encryptedAESKey) 
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

	socket.on("msg", encrypted => {
		let data = JSON.parse(decrypt(encrypted))
		//TODO change favicon
		addMsgElement(data.username, data.content, new Date())
	})

	socket.on("systemMessage", message => {
		let data = decrypt(message)
		sendSystemMessage(`SERVER: ${data}`)
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
			socket.emit("switchChannel", encrypt(channel))
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
		socket.emit("sendMessage", encrypt(content))
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
		document.querySelector("#sendMessageButton").click();
	}
})

