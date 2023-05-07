import { openDB, deleteDB, wrap, unwrap } from 'https://cdn.jsdelivr.net/npm/idb@7/+esm';

const SCAN_DELAY = 1000
const INNER_SCAN_DELAY = 1000
const RESCAN_TIME = 1000
const HIDDEN_OPACITY = 0.3

const db = await openDB("vineyard", 6, {
	upgrade(db, old, newV, transaction, event) {
		console.log(old, newV, transaction, event)
		db.deleteObjectStore('items')
		const itemStore = db.createObjectStore("items", {
			keyPath: "ASIN",
		});
		itemStore.createIndex("foundDate", "foundDate", { unique: false })
		itemStore.createIndex("lastScanDate", "lastScanDate", { unique: false })
		itemStore.createIndex("productName", "productName", { unique: false });
	}
});

const todoQueue = []
let todoRunning = false
function runQueue() {
	if (!todoRunning && todoQueue.length > 0) {
		todoRunning = true
		performDeepScan(todoQueue.shift())
	}
}

async function performDeepScan(item) {
	console.log(item)
	console.log("will deep scan" + item.ASIN)

	const variants = {}
	if (item.parentASIN) {
		// scan for recommendations
		const resp = await fetch(`https://www.amazon.com/vine/api/recommendations/${encodeURIComponent(item.dataRecID)}`)
		if (resp.status == 200) {
			const blob = await resp.json()
			console.log(blob)
			for (const variant of blob.result.variations) {
				variants[variant.asin] = {
					dimensions: variant.dimensions
				}
			}
		}
	} else {
		variants[item.ASIN] = {}
	}
	for (const variantASIN of Object.keys(targetASINs)) {
		console.log("looking at variant " + variantASIN)
		const resp = await fetch(`https://www.amazon.com/vine/api/recommendations/${encodeURIComponent(item.dataRecID)}/item/${variantASIN}?imageSize=180`)
		if (resp.status == 200) {
			const blob = await resp.json()
			console.log(blob)
		}
		await new Promise((resolve) => setTimeout(resolve, INNER_SCAN_DELAY)) // force min delay between scans
	}
	console.log(variants)
	await new Promise((resolve) => setTimeout(resolve, SCAN_DELAY)) // force min delay between scans
	todoRunning = false
	runQueue()
}
async function scanItem(element, item) {
	console.log(element, item)
	if (item.hidden) {
		element.style.opacity = HIDDEN_OPACITY;
	}
	element.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
	// rescan if necessary
	const lastScan = new Date() - (item.lastScanDate ?? 0)
	if (lastScan > RESCAN_TIME) {
		todoQueue.push(item)
		console.log("queued " + item.ASIN)
		runQueue()
	}
}
async function lookForItems() {
	for (const itemEl of document.querySelectorAll('.vvp-item-tile')) {
		const itemRecID = itemEl.attributes.getNamedItem("data-recommendation-id").value

		const [marketplaceID, ASIN] = itemRecID.split('#')
		let item = await db.get("items", ASIN)
		if (item === undefined) {
			const imageURL = itemEl.attributes.getNamedItem("data-img-url").value
			const itemLink = itemEl.querySelector(':scope .a-truncate-full')
			const itemBtn = itemEl.querySelector(':scope input')

			item = {
				ASIN,
				foundDate: new Date(),
				marketplaceID,
				productName: itemLink.textContent,
				imageURL,
				initialRecType: itemBtn.attributes.getNamedItem("data-recommendation-type").value,
				dataRecID: itemRecID,
				parentASIN: itemBtn.attributes.getNamedItem("data-is-parent-asin").value == 'true',
				deepASIN: itemBtn.attributes.getNamedItem("data-asin").value,
				lastScanDate: null,
				hidden: false,
				interested: null,
				variants: []
			}
			db.add("items", item)
		}
		item.dataRecID = itemRecID;

		await scanItem(itemEl, item)
	}
}
window.vineyard = db
await lookForItems()
