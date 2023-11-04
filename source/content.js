import readNDJSONStream from "ndjson-readablestream";

console.log("💈 Content script loaded for", chrome.runtime.getManifest().name);

// TODO: this button should be in the browser UI bar, not in the document
function createSetupButton(clickHandler) {
	const setupButton = document.createElement("button");
	setupButton.innerHTML = "Scan images";
	document.body.prepend(setupButton);
	setupButton.id = "setup-button";
	setupButton.addEventListener("click", clickHandler);
}

async function scanImages() {
	const goodImages = [];
	const badImages = [];

	function walkTheDOM(node) {
		if (node.hasChildNodes()) {
			node.childNodes.forEach(walkTheDOM);
		} else if (node.nodeName === "IMG") {
			const { alt, src } = node;
			// TODO: find better heuristic than just short alt
			if (alt.length < 20) {
				badImages.push({ alt, src, node });
			} else {
				goodImages.push({ alt, src, node });
			}
		}
	}

	walkTheDOM(document.body);

	console.log(
		"Images with good alt:\n",
		goodImages.map(({ alt, src }) => `* ${src}: ${alt}`).join("\n")
	);
	console.log(
		"Images with bad alt:\n",
		badImages.map(({ alt, src }) => `* ${src}: ${alt}`).join("\n")
	);

	for (const img of badImages) {
		console.log(`Sending image ${img.src} to model`);
		const start = Date.now();
		const alt = await getImgDescriptionFromLlamaCPP(imgToBase64JPEG(img.node));
		const time = Date.now() - start;
		console.log(`Description for image ${img.src} (in ${time}ms): ${alt}`);
		img.node.alt = alt;
	}
}

function imgToBase64JPEG(img) {
	// Render image to a canvas
	const canvas = document.createElement("canvas");
	canvas.width = img.width;
	canvas.height = img.height;
	canvas.getContext("2d").drawImage(img, 0, 0);

	// Get Base64 JPEG
	const base64Image = canvas.toDataURL("image/jpeg");

	canvas.remove();

	// Remove prefix
	return base64Image.replace(/^data:image\/jpeg;base64,/, "");
}

let id = 0;
async function getImgDescriptionFromLlamaCPP(imageBase64) {
	id += 1;
	const response = await fetch("http://localhost:8080/completion", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			stream: false,
			n_predict: 400,
			temperature: 0,
			stop: ["</s>", "Llama:", "User:"],
			repeat_last_n: 256,
			repeat_penalty: 1.18,
			top_k: 10,
			top_p: 0.5,
			tfs_z: 1,
			typical_p: 1,
			presence_penalty: 0,
			frequency_penalty: 0,
			mirostat: 0,
			mirostat_tau: 5,
			mirostat_eta: 0.1,
			grammar: "",
			n_probs: 0,
			image_data: [
				{
					data: imageBase64,
					id,
				},
			],
			cache_prompt: true,
			slot_id: -1,
			prompt: `A chat between a curious human and an artificial intelligence assistant. The assistant gives helpful, detailed, and polite answers to the human's questions.\nUSER:[img-${id}]Describe the image in detail.\nASSISTANT: `,
		}),
	});

	let answer = "";
	for await (const event of readNDJSONStream(response.body)) {
		answer += event.content;
	}
	return answer;
}

createSetupButton(scanImages);
