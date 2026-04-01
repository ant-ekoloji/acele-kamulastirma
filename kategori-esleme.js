// kategori-esleme.js
(function() {
    const kategoriEsleme = {
        "Diğer": "Diğer",
        "Enerji İletim/Dağıtım": "Enerji",
        "Demiryolu/Raylı Sistem": "Ulaşım",
        "Doğal Gaz": "Enerji",
        "GES (Güneş/Biyogaz Enerjisi)": "Enerji",
        "HES (Hidroelektrik)": "Enerji",
        "Su/Sulama/Baraj": "Altyapı",
        "Afet/Deprem": "Kentsel Dönüşüm",
        "Maden/Petrol": "Maden / Petrol",
        "Karayolu": "Ulaşım",
        "Kentsel Dönüşüm": "Kentsel Dönüşüm",
        "Konut (TOKİ/Sosyal)": "Konut",
        "RES (Rüzgar Enerjisi)": "Enerji",
        "Sanayi Bölgesi (OSB)": "Altyapı",
        "Arkeoloji/Kültürel Miras": "Tarihi Sit Alanları",
        "RES+GES (Hibrit)": "Enerji",
        "Lojistik/Ulaştırma": "Ulaşım"
    };

    function kategoriDonustur(orijinalKategori) {
        if (!orijinalKategori) return "Diğer";
        return kategoriEsleme[orijinalKategori] || orijinalKategori;
    }

    // Mevcut yükleme fonksiyonunu yakala ve genişlet
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
        return originalFetch.apply(this, args).then(response => {
            if (args[0] && args[0].includes && args[0].includes('.geojson')) {
                const clonedResponse = response.clone();
                clonedResponse.json().then(data => {
                    if (data.features) {
                        data.features.forEach(feature => {
                            if (feature.properties && feature.properties.kategori) {
                                feature.properties.kategori = kategoriDonustur(feature.properties.kategori);
                            }
                        });
                        // Dönüştürülen veriyi uygulamaya ilet (global değişken veya event ile)
                        if (window.updateGeoJSONData) {
                            window.updateGeoJSONData(data);
                        }
                    }
                }).catch(e => console.log('GeoJSON dönüştürme hatası:', e));
            }
            return response;
        });
    };
})();