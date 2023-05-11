(async function () {
  const element = document.querySelector("#qbShopTotalProduct");

  const productCount = await fetch("/apps/qbtestappclient/products-count");
  const productCountJson = await productCount.json();

  element.textContent = productCountJson.countData.count;
})();
