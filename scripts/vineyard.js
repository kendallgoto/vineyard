import {
	openDB, deleteDB, wrap, unwrap,
} from 'https://cdn.jsdelivr.net/npm/idb@7/+esm';

const SCAN_DELAY = 1000;
const INNER_SCAN_DELAY = 0;
const RESCAN_TIME = 1000 * 60 * 60 * 24 * 14;
const HIDDEN_OPACITY = 0.3;
const MAX_VARIANTS = 1; // only scan up to 3 variants per item
const NEW_PERIOD = 1000*60*30; // items first seen in the past 30 min are "new"

(async function () {
	const db = await openDB('vineyard', 6, {
		upgrade(db, old, newV, transaction, event) {
			console.log(old, newV, transaction, event);
			db.deleteObjectStore('items');
			const itemStore = db.createObjectStore('items', {
				keyPath: 'ASIN',
			});
			itemStore.createIndex('foundDate', 'foundDate', { unique: false });
			itemStore.createIndex('lastScanDate', 'lastScanDate', { unique: false });
			itemStore.createIndex('productName', 'productName', { unique: false });
		},
	});

	let todoQueue = [];
	let todoRunning = false;
	function runQueue() {
		if (!todoRunning && todoQueue.length > 0) {
			todoRunning = true;
			performDeepScan(todoQueue.shift());
		}
	}

	async function performDeepScan(item) {
		if (!item.hidden) {
			console.log(`will deep scan ${item.ASIN}`);

			const variants = {};
			if (item.parentASIN) {
				// scan for recommendations
				const resp = await fetch(`https://www.amazon.com/vine/api/recommendations/${encodeURIComponent(item.dataRecID)}`);
				if (resp.status == 200) {
					const blob = await resp.json();
					if (!blob.error) {
						for (const variant of blob.result.variations) {
							variants[variant.asin] = {
								dimensions: variant.dimensions,
							};
						}
					}
				}
			} else {
				variants[item.ASIN] = {};
			}
			let variantsScanned = 0;
			for (const variantASIN of Object.keys(variants)) {
				if (variantsScanned > MAX_VARIANTS) {
					break;
				}
				console.log(`looking at variant ${variantASIN}`);
				const resp = await fetch(`https://www.amazon.com/vine/api/recommendations/${encodeURIComponent(item.dataRecID)}/item/${variantASIN}?imageSize=180`);
				if (resp.status == 200) {
					const blob = await resp.json();
					console.log(blob);
					if (!blob.error) {
						variants[variantASIN].byline = blob.result.byLineContributors;
						variants[variantASIN].limited = blob.result.limitedQuantity;
						variants[variantASIN].catSize = blob.result.catalogSize;
						variants[variantASIN].taxValue = blob.result.taxValue;
						variants[variantASIN].taxCurr = blob.result.taxCurrency;
					}
				}
				variantsScanned++;
				await new Promise((resolve) => setTimeout(resolve, INNER_SCAN_DELAY)); // force min delay between scans
			}
			item.variants = variants;
			item.lastScanDate = new Date();
			// save over
			await db.put('items', item);
		}
		// find item and render too ...
		renderItem(document.querySelector(`[data-recommendation-id="${item.dataRecID}"]`), item);
		await new Promise((resolve) => setTimeout(resolve, SCAN_DELAY)); // force min delay between scans
		todoRunning = false;
		runQueue();
	}
	async function renderLoadingItem(element, item) {
		element.insertAdjacentHTML("afterbegin", `
		<div class="vineyard-content" data-asin="${item.ASIN}">
			<div class="vineyard-flex">
				<div class="vineyard-label">
					<span class="vineyard-price">Loading ...</span>
				</div>
				<div class="vineyard-btns">
					<button class="vineyard-trash">🗑️</button>
				</div>
			</div>
		</div>`);
	}
	async function renderItem(element, item) {
		if (item.hidden) {
			element.style.opacity = HIDDEN_OPACITY;
		} else {
			element.style.opacity = 1;
		}

		if (item.interested === true) {
			element.style.backgroundColor = 'rgba(0, 255, 0, 0.2)';
		} else if (item.interested === false) {
			element.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
		} else if (!item.hidden) {
			if (new Date() - item.foundDate < NEW_PERIOD) {
				element.style.backgroundColor = 'rgba(255, 215, 0, 0.2)';
			}
		}
		const existingOverlay = element.querySelector(':scope > .vineyard-content');
		if (existingOverlay) {
			existingOverlay.remove();
		}
		const variantCount = Object.keys(item.variants).length;
		let priceLow, priceHigh;
		if (variantCount > 0) {
			priceLow = item.variants[Object.keys(item.variants).reduce((a, b) => item.variants[a].taxValue < item.variants[b].taxValue ? a : b)].taxValue;
			priceHigh = item.variants[Object.keys(item.variants).reduce((a, b) => item.variants[a].taxValue > item.variants[b].taxValue ? a : b)].taxValue;
			if (variantCount == 1) {
				priceHigh = "";
			} else {
				priceHigh = ` - $${priceHigh}`;
			}
		} else {
			priceLow = "Not Scanned";
			priceHigh = "";
		}
		const isInterested = item.interested === true ? " active" : "";
		const isNotInterested = item.interested === false ? " active" : "";
		const isTrash = item.hidden ? " active" : "";
		element.insertAdjacentHTML("afterbegin", `
		<div class="vineyard-content" data-asin="${item.ASIN}">
			<div class="vineyard-flex">
				<div class="vineyard-label">
					<span class="vineyard-price">$${priceLow}${priceHigh}</span>
					<span class="vineyard-variants">${variantCount} variants</span>
				</div>
				<div class="vineyard-btns">
					<button class="vineyard-interested${isInterested}">👍</button>
					<button class="vineyard-notinterested${isNotInterested}">👎</button>
					<button class="vineyard-trash${isTrash}">🗑️</button>
				</div>
			</div>
		</div>`);
	}
	async function scanItem(element, item) {
		const lastScan = new Date() - item.lastScanDate;
		if (lastScan > RESCAN_TIME) {
			renderLoadingItem(element, item);
			todoQueue.push(item);
			console.log(`queued ${item.ASIN}`);
			runQueue();
			return;
		}
		renderItem(element, item);
	}
	async function lookForItems() {
		for (const itemEl of document.querySelectorAll('.vvp-item-tile')) {
			const itemRecID = itemEl.attributes.getNamedItem('data-recommendation-id').value;

			const [marketplaceID, ASIN] = itemRecID.split('#');
			let item = await db.get('items', ASIN);
			if (item === undefined) {
				const imageURL = itemEl.attributes.getNamedItem('data-img-url').value;
				const itemLink = itemEl.querySelector(':scope .a-truncate-full');
				const itemBtn = itemEl.querySelector(':scope input');

				item = {
					ASIN,
					foundDate: new Date(),
					marketplaceID,
					productName: itemLink.textContent,
					imageURL,
					initialRecType: itemBtn.attributes.getNamedItem('data-recommendation-type').value,
					dataRecID: itemRecID,
					parentASIN: itemBtn.attributes.getNamedItem('data-is-parent-asin').value == 'true',
					deepASIN: itemBtn.attributes.getNamedItem('data-asin').value,
					lastScanDate: null,
					hidden: false,
					interested: null,
					variants: {},
				};
				await db.add('items', item);
			}
			item.dataRecID = itemRecID;

			await scanItem(itemEl, item);
		}
	}
	async function markInterested(e) {
		const ASIN = e.attributes.getNamedItem('data-asin').value;
		const item = await db.get('items', ASIN);
		if (item !== undefined) {
			if (item.interested === true) {
				item.interested = null;
			} else {
				item.hidden = false;
				item.interested = true;
			}
			await db.put('items', item);
			renderItem(e.closest(".vvp-item-tile"), item);
		}
	}
	async function markNotInterested(e) {
		const ASIN = e.attributes.getNamedItem('data-asin').value;
		const item = await db.get('items', ASIN);
		if (item !== undefined) {
			if (item.interested === false) {
				item.interested = null;
			} else {
				item.interested = false;
			}
			await db.put('items', item);
			renderItem(e.closest(".vvp-item-tile"), item);
		}
	}
	async function markTrash(e) {
		const ASIN = e.attributes.getNamedItem('data-asin').value;
		const item = await db.get('items', ASIN);
		if (item !== undefined) {
			item.hidden = !item.hidden;
			item.interested = null;
			await db.put('items', item);
			todoQueue = todoQueue.filter(function(e) { return e !== ASIN; });
			renderItem(e.closest(".vvp-item-tile"), item);
		}
	}

	document.addEventListener("click", function(e) { // e = event object
		if (e.target && e.target.matches(".vineyard-interested")) {
			markInterested(e.target.closest(".vineyard-content"));
		}
		else if (e.target && e.target.matches(".vineyard-notinterested")) {
			markNotInterested(e.target.closest(".vineyard-content"));
		}
		else if (e.target && e.target.matches(".vineyard-trash")) {
			markTrash(e.target.closest(".vineyard-content"));
		}

	});
	window.vineyard = db;
	await lookForItems();
}());
