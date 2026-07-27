const renderDocument = () => {
    const ef = new Equifield($('.preview-equifield')[0]);
    if (!('efData' in window)) {
        // Say something about what this is if somebody try to open the template in browser
        ef.render([
            {
                element: $('<span style="font-size:3em;font-weight:700;color:#000">SparksNMN Preview Template</span>')[0],
                height: 6,
                padding: [11, 11]
            },
            {
                element: $('<span style="font-size:1.95em;color:#000;">This is the template file for generating HTML previews.</span>')[0],
                height: 3,
                padding: [11, 11]
            },
            {
                element: $('<span style="font-size:1.95em;color:#000;">You should not open it directly. Here\'s nothing useful.</span>')[0],
                height: 3,
                padding: [11, 11]
            }
        ])
    } else {
        ef.render(efData.map((section) => {
            const { element, ...other } = section
            return {
                element: $(element)[0],
                ...other
            }
        }))
    }
    if (location.hash == '#print') {
        setTimeout(() => window.print(), 1)
    }
};