window.fontCdnRoot = 'https://fastly.jsdelivr.net/gh/yezhiyi9670/sparks-notation-1@latest/packages/static-resources/core-resources/font'
const fontDataProcessed = window.fontLoadData.map(item => {
    const url = item.url
    const urlList = []
    if (window.localFontLocation) {
        urlList.push(window.localFontLocation + '/' + url)
    }
    urlList.push(window.fontCdnRoot + '/' + url)
    return {
        ...item,
        url: urlList
    }
})
FontLoader.loadFonts(fontDataProcessed, renderDocument)