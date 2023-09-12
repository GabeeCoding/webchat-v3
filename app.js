const http = require("http")
const express = require("express")
const socketio = require("socket.io")
const CryptoJS = require("crypto-js")
const crypto = require("crypto")
const markdownit = require("markdown-it")

let markdownParser = markdownit({
	html: false,
	breaks: true,
	linkify: true
})

function mp4EmbedPlugin(md, options) {
	// Add a custom rule to parse MP4 video links with the @[video]() syntax
	md.inline.ruler.before('link', 'mp4-embed', (state, silent) => {
		if (silent) return false;
		const regex = /^\@\[video\]\(([^)]+)\)$/i;
		const match = state.src.match(regex);

		if (!match) return false;

		const token = state.push('mp4-embed', 'video', 0);
		token.content = match[1];
		token.markup = '@[video](';
		token.map = [state.pos, state.posMax];
		state.pos = state.posMax;

		return true;
	});

	// Render the parsed MP4 video links as HTML <video> elements with <source> elements
	md.renderer.rules['mp4-embed'] = (tokens, idx) => {
		const token = tokens[idx];
		const videoURL = token.content;

		return `<video controls><source src="${videoURL}"></video>`;
	};
}

markdownParser.use(mp4EmbedPlugin)

const fs = require("fs")
const path = require("path")

const app = express()
const server = http.createServer(app)
const io = new socketio.Server(server, {cors: {origin: "*"}})
io.listen(server)

const pubKeyFile = path.join(__dirname, "key_pub.pem")
const privateKeyFile = path.join(__dirname, "key.pem")

console.log("pub key exists", fs.existsSync(pubKeyFile))
console.log("private key exists", fs.existsSync(privateKeyFile))

let publicKey, privateKey

if(fs.existsSync(pubKeyFile) && fs.existsSync(privateKeyFile)){
	//load from file
	console.log("Importing key pair from file")
	publicKey = fs.readFileSync(pubKeyFile, "utf8")
	privateKey = fs.readFileSync(privateKeyFile, "utf8")
} else {
	//generate key pair
	console.log("Generating new key pair")
	let keys = crypto.generateKeyPairSync("rsa", {
		modulusLength: 1024,
		publicKeyEncoding: {
			type: 'spki',
			format: 'pem'
		},
		privateKeyEncoding: {
			type: 'pkcs8',
			format: 'pem',
		}
	})
	publicKey = keys.publicKey
	privateKey = keys.privateKey
	fs.writeFile(path.join(__dirname, "key_pub.pem"), publicKey, "utf8", err => console.error)
	fs.writeFile(path.join(__dirname, "key.pem"), privateKey, "utf8", err => console.error)
}

const publicKeyHash = crypto.createHash("sha256")
publicKeyHash.update(publicKey)
const publicKeyChecksum = publicKeyHash.digest("hex")

console.log(publicKey)

console.log("public key checksum", publicKeyChecksum)

let usernames = {}

function encryptWithKey(text, key){
	return CryptoJS.AES.encrypt(text, key).toString()
}

function sendToChannel(channel, content, isSystemMessage, userData){
	for (const [sid, user] of Object.entries(usernames)) {
		if(user["channel"] !== undefined && user["channel"] === channel){
			let key = user["aesKey"]
			if(key === undefined){
				console.error(`no AES key for sid ${sid} username ${user["username"]}`)
				return
			}
			if(isSystemMessage){
				io.to(sid).emit("systemMessage", encryptWithKey(content, key))
			} else {
				io.to(sid).emit("msg", encryptWithKey(JSON.stringify({"username": userData["username"], "content": content}), key))
			}
		}
	}
}

app.use((req, resp, next) => {
	resp.header('Access-Control-Allow-Origin', req.get('Origin') || '*');
	if (req.method === 'OPTIONS') {
		return res.send(200);
	} else {
		return next();
	}
})

app.use(express.static("public"))

app.use((req, res, next) => {
	var data='';
	req.setEncoding('utf8');
	req.on('data', function(chunk) { 
		data += chunk;
	});

	req.on('end', function() {
		req.body = data;
		next();
	});
});

app.get("/publickeychecksum", (req, resp) => {
	resp.send(publicKeyChecksum)
})

app.get("/publickey", (req, resp) => {
	resp.send(publicKey)
})

app.get("/usercount", (req, resp) => {
	resp.send(Object.keys(usernames).length.toString())
})

io.on("connection", socket => {
	let sid = socket.id
	usernames[sid] = {}

	const encrypt = data => {
		//encrypt AES
		return CryptoJS.AES.encrypt(data, usernames[sid]["aesKey"]).toString()
	}

	const sendSystemMessage = message => {
		io.to(sid).emit("systemMessage", encrypt(message))
	}

	const disconnect = () => {
		socket.disconnect()
		delete usernames[sid]
	}

	socket.on("encryptedKey", encrypted => {
		//string data
		let decrypted
		try {
			decrypted = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(encrypted, "base64")).toString()
		} catch (err){
			console.error("handled exception: error decrypting aes key")
			console.error(err)
			socket.emit("decryptKeyFailed")
			disconnect()
			return
		}
		console.log("done")
		console.log(decrypted)
		//TODO: verify that key works, send message to client, expect specific response. If no correct response, disconnect client
		if(usernames[sid]["aesKey"] !== undefined){
			console.error("aes key already exists")
			return
		}
		usernames[sid]["aesKey"] = decrypted
		socket.emit("keyDecrypted")
	})

	const decryptData = encrypted => {
		if(!encrypted || usernames[sid]["aesKey"] === undefined){
			disconnect()
			return { ok: false }
		}
		return { ok: true, data: CryptoJS.AES.decrypt(encrypted, usernames[sid]["aesKey"]).toString(CryptoJS.enc.Utf8)}
	}

	socket.on("getChannels", () => {
		listOfChannels = []
		for (user of Object.values(usernames)){
			if("channel" in user && !listOfChannels.find(cname => user["channel"] === cname)){
				listOfChannels.push(user["channel"])
			}
		}
		console.log("channel list", listOfChannels)
		channelsWithMembers = [] 
		listOfChannels.forEach(channel => {
			inChannel = []
			for (user of Object.values(usernames)){
				if("channel" in user && "username" in user && user["channel"] === channel){
					inChannel.push(user["username"])
				}
			}
			channelsWithMembers.push(`${channel} (${inChannel.join(", ")})`)
		})
		console.log("channels with members", channelsWithMembers)
		sendSystemMessage(channelsWithMembers.join(", "))
	})

	socket.on("usersInChannel", () => {
		let userData = usernames[sid]
		if(!("channel" in userData)){
			sendSystemMessage("Failed to get users in channel: Not in channel")
			return
		}
		let channel = userData["channel"]
		let usersInChannel = []
		for(user of Object.values(usernames)){
			if("channel" in user && user["channel"] === channel){
				usersInChannel.push(user["username"])
			}
		}
		sendSystemMessage(`${usersInChannel.length} in channel: ${usersInChannel.join(", ")}`)
	})

	socket.on("assignUsername", encrypted => {
		let { ok, data } = decryptData(encrypted)
		if(!ok) return
		if(data.toLowerCase() === "system"){
			sendSystemMessage(`Failed to assign username: ${data} is a reserved username`)
			disconnect()
			return
		}

		if(data.length > 30){
			sendSystemMessage("Failed to assign username: Username too long (30 character limit)")
			disconnect()
			return
		} 
		//TODO check for username length and attempts to switch twice
		const duplicate_recursive = username => {
			for (let v of Object.values(usernames)) {
				console.log("whatttt", v)
				if(v["username"] !== undefined && v["username"] === username){
					return duplicate_recursive(username + " (duplicate)")
				}
			}
			return username
		}
		let username = duplicate_recursive(data)
		usernames[sid]["username"] = username
		sendSystemMessage(`Username set to ${username}`)
		console.log(usernames)
	})

	socket.on("sendMessage", encrypted => {
		let { ok, data } = decryptData(encrypted)
		if(!ok) return
		let channel = usernames[sid]["channel"]
		if(channel === undefined){
			sendSystemMessage("You need to switch to a channel first. Type /channel channelName to switch.")
			return
		}
		//parse data with markdown
		let rendered = markdownParser.render(data)
		sendToChannel(channel, rendered, false, usernames[sid])
	})

	socket.on("switchChannel", encrypted => {
		let { ok, data } = decryptData(encrypted)
		if(!ok) return
		if(data === ""){
			sendSystemMessage("Channel is blank")
			return
		}
		if(usernames[sid]["channel"] !== undefined){
			if(data === usernames[sid]["channel"]){
				sendSystemMessage("Error: Can't switch to same channel")
				return
			}
			if(usernames[sid]["username"]){
				sendToChannel(usernames[sid]["channel"], `${usernames[sid]["username"]} switched to another channel`, true)
			}
		}
		usernames[sid]["channel"] = data
		sendSystemMessage("Successfully switched channel")
		sendToChannel(data, `${usernames[sid]["username"]} joined the channel`, true)
	})

	socket.on("disconnect", () => {
		console.log(`${sid} disconnected`)
		if(usernames[sid] !== undefined){
			if(usernames[sid]["channel"] !== undefined){
				sendToChannel(usernames[sid]["channel"], `${usernames[sid]["username"]} disconnected`, true)
			}
		}
		delete usernames[sid]
	})
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => console.log(`Listening on port ${PORT}`))
