
(function () {




    var cheerio          = require('cheerio'),
        async            = require('async'),
        Promise          = require('bluebird'),
        Request          = require('request'),
        fs               = require('fs-extra'),
        validate         = require('validate.io' ),
        ProgressNotifier = require('progress-notifier');


    Promise.promisifyAll(Request);
    Promise.promisifyAll(fs);


    var AmazonRequest = Request.defaults({
        headers : {
            'User-Agent'     : 'Mozilla/5.0 (Windows NT 6.1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/41.0.2228.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.8,nl;q=0.6',
            'Accept'         : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        },
        // proxy : 'http://127.0.0.1:8888'
    });
    Promise.promisifyAll(AmazonRequest);














    var langs = {
                'com' : {

                    'host'                                            : 'amazon.com',
                    'domain'                                          : 'com',

                    'money_sign'                                      : '$',

                    'listingHasInternationalShipping_detectionString' : 'international',

                    'ratesPerItemWeightAndShipment_location'          : 'Europe',
                    'ratesPerItemWeightAndShipment_standardShipmend'  : 'Standard',

                    'productPageWeightIdentifier'                     : 'weight',

                    'amazonShippingPrices'                            : {
                        'shipment'  : 3.99,
                        'item'      : 3.99,
                        'weight'    : 1.99,
                        'free_from' : 9999999,
                    },

                },
                'de' : {

                    'host'                                            : 'amazon.de',
                    'domain'                                          : 'de',

                    'money_sign'                                      : 'EUR ',

                    'listingHasInternationalShipping_detectionString' : 'international',

                    'ratesPerItemWeightAndShipment_location'          : 'Belgien',
                    'ratesPerItemWeightAndShipment_standardShipmend'  : 'Standard',

                    'productPageWeightIdentifier'                     : 'Produktgewicht ',

                    'amazonShippingPrices'                            : {
                        'shipment'  : 3.25,
                        'item'      : 0,
                        'weight'    : 0.5,
                        'free_from' : 29,
                    },
                },
                'co.uk' : {

                    'host'                                            : 'amazon.co.uk',
                    'domain'                                          : 'co.uk',

                    'money_sign'                                      : '£',

                    'listingHasInternationalShipping_detectionString' : 'international',

                    'ratesPerItemWeightAndShipment_location'          : 'Europe Zone 1',
                    'ratesPerItemWeightAndShipment_standardShipmend'  : 'Standard',

                    'productPageWeightIdentifier'                     : 'weight',

                    'amazonShippingPrices'                            : {
                        'shipment'  : 4,
                        'item'      : 0,
                        'weight'    : 0.4,
                        'free_from' : 9999999,
                    },
                },
                'fr' : {

                    'host'                                            : 'amazon.fr',
                    'domain'                                          : 'fr',

                    'money_sign'                                      : 'EUR ',

                    'listingHasInternationalShipping_detectionString' : 'internationaux',

                    'ratesPerItemWeightAndShipment_location'          : 'Europe: autres',
                    'ratesPerItemWeightAndShipment_standardShipmend'  : 'Standard',

                    'productPageWeightIdentifier'                     : 'poids',

                    'amazonShippingPrices'                            : {
                        'shipment'  : 6,
                        'item'      : 0,
                        'weight'    : 0,
                        'free_from' : 25,
                    },
                },
    };


















    var AmazonPriceGetter = function(language){

        var priv = {},
            publ = {},
            lang = language;

        priv.progressNotifier = ProgressNotifier();

        priv.requestQueue = async.priorityQueue(function(url, cb){

            // console.log('request start: ', url);
            AmazonRequest.getAsync(url).spread(function(response, body){

                // console.log('request stop : ', url);

                if(body.indexOf('Correios.DoNotSend')>-1){


                    var file = './test/AmazonPriceGetter.html';

                    fs.writeFileAsync(file, body)
                        .catch(function(e){

                            console.log('Error writing to file: ['+file+'] : ', e);
                        })
                        .finally(function(){

                            cb('ERROR: Could not load page; amazon detected automation. Url = ' + url);
                        });
                    
                    return;
                }

                cb(null, body);
            }, function(err){
                cb(err);
            });
        }, 10);

        priv.matchers = {

            listingHasInternationalShipping : function(jqListing){

                var v = jqListing.find('.olpDeliveryColumn a[href^="/gp/aag/details/"]').html();

                if(!v){

                    return undefined;
                }

                return v.toLowerCase().indexOf(lang.listingHasInternationalShipping_detectionString) >= 0;
            },
            listingByAmazon                 : function(jqListing){

                var sellerNameContainer = jqListing.find('.olpSellerColumn .olpSellerName');

                if(sellerNameContainer.length <= 0){

                    return undefined;
                }
                return sellerNameContainer.find('a').length === 0;
            },
            listingFBA                      : function(jqListing){

                return jqListing.find('.olpDeliveryColumn .olpBadgeContainer').length > 0;
            },
            listingHasAmazonShipping        : function(jqListing){

                return priv.matchers.listingByAmazon(jqListing) || priv.matchers.listingFBA(jqListing);
            },
            listingOnlyForPrime             : function(jqListing){
                
                return jqListing.find('.olpBuyColumn #a-popover-prime-exclusive-intro').length > 0;
            },
        };
        priv.parsers = {

            productPage : {

                getExists                       : function(cProductPage){

                    return cProductPage.root()
                                .find('#add-to-cart-button')
                                .add('#buybox-see-all-buying-choices-announce')
                                    .length > 0;



                    // return cProductPage.root()
              //                .find('#add-to-wishlist-button-submit')
              //                .add('#wishlistAddButtonActive')
              //                .add('#buyboxDivId')
              //                    .parents('form')
              //                    .find('input[name="ASIN"]').length > 0;
                },
                validateExists                  : function(v){

                    return validate('boolean', v);
                },


                getWeight                       : function(cProductPage){


                    // detect detail panel type
                    var detailBulletsPanelTypeSelection = cProductPage.root().find('#detail-bullets .content li a[href^="/gp/help/seller/shipping.html"]').parent(),
                        prodDetailsPanelTypeSelection   = cProductPage.root().find('#prodDetails .content tr.shipping-weight td.value'),
                        prodDetailsPanelTypeSelection2  = cProductPage.root().find('#prodDetails .content tr td.label').filter(function(){return cProductPage(this).html().toLowerCase().indexOf(lang.productPageWeightIdentifier.toLowerCase())>-1;}).next(),
                        prodDetailsPanelTypeSelection3  = cProductPage.root().find('#detail_bullets_id .content li ').filter(function(){return cProductPage(this).html().toLowerCase().indexOf(lang.productPageWeightIdentifier.toLowerCase())>-1;})
                        ;


                    var selection =        detailBulletsPanelTypeSelection
                                    .add(  prodDetailsPanelTypeSelection   )
                                    .add(  prodDetailsPanelTypeSelection2  )
                                    .add(  prodDetailsPanelTypeSelection3  )
                                    .eq(0);

                    var weight    = selection.clone().children().remove().end().text().replace(/(\(|\))/g, '').trim();

                    return priv.convertors.weightToBaseUnity(weight);
                },
                validateWeight                  : function(v){

                    return validate('number|positive', v);
                },

                getProductId                    : function(cProductPage){

                    var v = cProductPage.root()
                                .find('#add-to-wishlist-button-submit')
                                .add('#wishlistAddButtonActive')
                                .add('#buyboxDivId')
                                    .parents('form')
                                    .find('input[name="ASIN"]')
                                        .val();

                    if(!v){
                        return false;
                    }
                    return v;
                },
                validateProductId               : function(v){
                    
                    return validate('alphanumeric', v);
                },


                getNumNewListings               : function(cProductPage){

                    var numString = cProductPage.root()
                        .find('#olp_feature_div')
                        .add('#olp-condition-link_feature_div')
                            .find('a[href^="/gp/offer-listing/"]')
                                .eq(0)
                                .html();

                    var v = parseInt(numString, 10);
                                        
                    if(!v){
                        return 1;
                    }
                    return v;
                },
                validateNumNewListings          : function(v){
                    
                    return validate('integer|positive', v);
                },


                getAll                          : function(cProductPage){

                    return {
                        weight         : priv.parsers.productPage.getWeight         (cProductPage),
                        productId      : priv.parsers.productPage.getProductId      (cProductPage),
                        numNewListings : priv.parsers.productPage.getNumNewListings (cProductPage),
                        exists         : priv.parsers.productPage.getExists         (cProductPage),
                    };
                },
                validateEach                    : function(productPageData){

                    if(!productPageData){
                        return false;
                    }

                    return {
                        weight         : productPageData.hasOwnProperty('weight')         && priv.parsers.productPage.validateWeight         (productPageData.weight         ),
                        productId      : productPageData.hasOwnProperty('productId')      && priv.parsers.productPage.validateProductId      (productPageData.productId      ),
                        numNewListings : productPageData.hasOwnProperty('numNewListings') && priv.parsers.productPage.validateNumNewListings (productPageData.numNewListings ),
                        exists         : productPageData.hasOwnProperty('exists')         && priv.parsers.productPage.validateExists         (productPageData.exists         ),
                    };
                },
                validateAll                     : function(productPageData){

                    var validationData = priv.parsers.productPage.validateEach(productPageData);

                    return (
                        validationData                      && (
                            (
                                validationData.exists && !productPageData.exists
                            ) || (
                                validationData.weight           &&
                                validationData.productId        &&
                                validationData.numNewListings
                            )
                        )
                    );
                },
            },

            listingsPage : {

                getExists                       : function(cListingsPage){

                    return cListingsPage.root().find('.olpOffer').length > 0;
                },
                validateExists                  : function(v){

                    return validate('boolean', v);
                },

                getCListings                   : function(cListingsPage){       // NOTE: should change this to getListings, which returns parsed listings

                    return cListingsPage.root().find('.olpOffer');
                },
                validateCListings               : function(cListings){
                    
                    var i,
                        listing,
                        parsed,
                        valid = true;

                    for(i=0;i<cListings.length;i++){

                        listing = cListings.eq(i);
                        parsed  = priv.parsers.listing.getAll(listing);
                        valid   = valid && priv.parsers.listing.validateAll(parsed);

                        if(!valid){
                            break;
                        }
                    }
                    

                    return valid;
                },

                getNumPages                     : function(cListingsPage){

                    var lastPageAnchor = cListingsPage.root().find('ul.a-pagination li:nth-last-child(2)>a');
                    
                    var numPages = parseInt(lastPageAnchor.html(), 10) || 1;

                    return numPages;
                },
                validateNumPages                : function(v){
                    
                    return validate('integer|positive', v);
                },

                getAll                          : function(cListingsPage){

                    var data =  {
                        cListings      : priv.parsers.listingsPage.getCListings      (cListingsPage),
                        numPages       : priv.parsers.listingsPage.getNumPages       (cListingsPage),
                        exists         : priv.parsers.listingsPage.getExists         (cListingsPage),
                    };


                    var i,
                        listing,
                        parsed;

                    data.listings = [];

                    for(i=0;i<data.cListings.length;i++){

                        listing = data.cListings.eq(i);
                        parsed  = priv.parsers.listing.getAll(listing);

                        data.listings.push(parsed);
                    }

                    return data;
                },
                validateEach                    : function(listingsPageData){

                    if(!listingsPageData){
                        return false;
                    }

                    return {
                        cListings      : listingsPageData.hasOwnProperty('cListings')      && priv.parsers.listingsPage.validateCListings      (listingsPageData.cListings      ),
                        numPages       : listingsPageData.hasOwnProperty('numPages')       && priv.parsers.listingsPage.validateNumPages       (listingsPageData.numPages       ),
                        exists         : listingsPageData.hasOwnProperty('exists')         && priv.parsers.listingsPage.validateExists         (listingsPageData.exists         ),
                    };
                },
                validateAll                     : function(listingsPageData){

                    var validationData = priv.parsers.listingsPage.validateEach(listingsPageData);

                    return (
                        validationData                      && (
                            (
                                validationData.exists           &&
                               !listingsPageData.exists
                            ) || (
                                validationData.cListings        &&
                                validationData.numPages
                            )
                        )
                    );
                },

            },
            listing : {

                getSellerId                     : function(jqListing){
                
                    var sellerRatingHref = jqListing.find('.olpDeliveryColumn li a[href*="seller="]').eq(0).attr('href');
                    if(!sellerRatingHref){
                        // console.log('Error: could not get sellerId (couldn\'t get anchor with href containering seller=)');
                        return false;
                    }
                    var p = sellerRatingHref.split('seller=');
                    var pp = p[1].split('&');
                    
                    return pp[0];
                },
                validateSellerId                : function(v){
                    
                    return validate('alphanumeric', v);
                },

                getBuyForm                      : function(jqListing){

                    return jqListing.find('.olpBuyColumn form');
                },
                validateBuyForm                 : function(v){
                    
                    return true;
                },

                getPrice                        : function(jqListing){

                    return priv.convertors.parseMoney(
                        jqListing.find('.olpOfferPrice').html()
                    );
                },
                validatePrice                   : function(v){
                    
                    return validate('number|nonnegative', v);
                },
                
                getHasAmazonShipping            : function(jqListing){

                    return priv.matchers.listingHasAmazonShipping(jqListing);
                },
                validateHasAmazonShipping       : function(v){
                    
                    return validate('boolean', v);
                },

                getHasInternationalShipping     : function(jqListing){

                    return priv.matchers.listingHasInternationalShipping(jqListing);
                },
                validateHasInternationalShipping  : function(v){
                    
                    return validate('boolean', v);
                },

                getIsPrimeOnly                  : function(jqListing){

                    return priv.matchers.listingOnlyForPrime(jqListing);
                },
                validateIsPrimeOnly             : function(v){
                    
                    return validate('boolean', v);
                },


                getAll                          : function(jqListing){

                    return {
                        sellerId                 : priv.parsers.listing.getSellerId                (jqListing),
                        buyForm                  : priv.parsers.listing.getBuyForm                 (jqListing),
                        price                    : priv.parsers.listing.getPrice                   (jqListing),
                        hasAmazonShipping        : priv.parsers.listing.getHasAmazonShipping       (jqListing),
                        hasInternationalShipping : priv.parsers.listing.getHasInternationalShipping(jqListing),
                        isPrimeOnly              : priv.parsers.listing.getIsPrimeOnly             (jqListing),
                    };
                },
                validateEach                    : function(listingData){

                    if(!listingData){
                        return false;
                    }

                    return {
                        sellerId                 : listingData.hasOwnProperty('sellerId')                 && priv.parsers.listing.validateSellerId                 (listingData.sellerId                 ),
                        buyForm                  : listingData.hasOwnProperty('buyForm')                  && priv.parsers.listing.validateBuyForm                  (listingData.buyForm                  ),
                        price                    : listingData.hasOwnProperty('price')                    && priv.parsers.listing.validatePrice                    (listingData.price                    ),
                        hasAmazonShipping        : listingData.hasOwnProperty('hasAmazonShipping')        && priv.parsers.listing.validateHasAmazonShipping        (listingData.hasAmazonShipping        ),
                        hasInternationalShipping : listingData.hasOwnProperty('hasInternationalShipping') && priv.parsers.listing.validateHasInternationalShipping (listingData.hasInternationalShipping ),
                        isPrimeOnly              : listingData.hasOwnProperty('isPrimeOnly')              && priv.parsers.listing.validateIsPrimeOnly              (listingData.isPrimeOnly              ),
                    };
                },
                validateAll                     : function(listingData){

                    var validationData = priv.parsers.listing.validateEach(listingData);

                    return (
                        validationData   && (

                          ( validationData.sellerId  ||
                                                            (
                                                                listingData.hasAmazonShipping && !listingData.isPrimeOnly
                                                            )
                          )                                            &&
                            validationData.buyForm                     &&
                            validationData.price                       &&
                            validationData.hasAmazonShipping           &&
                          (
                            validationData.hasInternationalShipping   ||
                                                            (
                                                                listingData.hasAmazonShipping && !listingData.isPrimeOnly
                                                            )
                          )                                            &&
                            validationData.isPrimeOnly
                        )
                    );
                },

                // TODO: add validation

            },
            pricePage : {

                getPriceInfo_weightBased        : function(cPricePage){
                    


                    var subTableHeaderRow   = cPricePage.root()
                                                .find('#standardRates_expanded')
                                                .find('strong')
                                                .filter(function(index, el){
                                                     return cPricePage(this).html().indexOf(lang.ratesPerItemWeightAndShipment_location)>=0;
                                                 })
                                                .parent()
                                                .parent();

                    

                    if(!subTableHeaderRow.length){


                        // bad listing; does not ship to your location!
                        return false;
                    }




                    
                    var standardColumn = false;
                    cPricePage.root()
                                .find('#standardRates_expanded')
                                .find('table').eq(1)                // NOTE: no ':eq(i)' pseudo-selector in CSS
                                .find('tr')   .eq(0)
                                .find('td')
                                .each(function(index, el){

                                    if(cPricePage(this).html().indexOf(lang.ratesPerItemWeightAndShipment_standardShipmend) >= 0){
                                        standardColumn = index + 1;
                                        return false;
                                    }
                                });
                    
                    if(standardColumn === false){

                        // bad listing; does not have standard shipping!
                        return false;
                    }
                    





                    
                    var itemRow     = subTableHeaderRow.next();
                    var weightRow   = subTableHeaderRow.next().next();
                    var shipmentRow = subTableHeaderRow.next().next().next();
                    

                    var results = {
                        item      : priv.convertors.parseMoney(itemRow    .find('td').eq(standardColumn).html()),
                        weight    : priv.convertors.parseMoney(weightRow  .find('td').eq(standardColumn).html()),
                        shipment  : priv.convertors.parseMoney(shipmentRow.find('td').eq(standardColumn).html()),
                    };


                    return results;
                },
                validatePriceInfo_weightBased   : function(v){

                    return  !v                                         || ( 
                            validate('number|nonnegative', v.item    ) &&
                            validate('number|nonnegative', v.weight  ) &&
                            validate('number|nonnegative', v.shipment)     );

                },
                getPriceInfo_priceBased         : function(cPricePage){
                    

                    var standardTable   = cPricePage.root()
                                            .find('#mainTable')
                                            .find('strong')
                                            .filter(function(index, el){
                                                  return cPricePage(this).html().indexOf(lang.ratesPerItemWeightAndShipment_standardShipmend)>=0;
                                             })
                                            .parent()
                                            .filter(function(index, el){
                                                  return cPricePage(this).html().indexOf(lang.ratesPerItemWeightAndShipment_location)>=0;
                                             })
                                            .parent()
                                            .parent();
                    
                    if(!standardTable.length){
                        // bad listing; does not ship to Europe!
                        return false;
                    }
                    


                    var results =  standardTable
                        .find('tr').slice(2)
                        .map(function(index, el){

                            var tds = cPricePage(this).find('td');
                            return {
                                'from'  : priv.convertors.parseMoney(tds.eq(0).html()),
                                'to'    : priv.convertors.parseMoney(tds.eq(2).html()),
                                'price' : priv.convertors.parseMoney(tds.eq(3).html()),
                            };
                        })
                        .get(); 


                    return results;
                },
                validatePriceInfo_priceBased    : function(v){

                    if(!v){
                        return true;
                    }

                    var i,
                        valid = true;
                    for(i=0;i<v.length;i++){

                        valid = valid && validate('number|nonnegative', v[i].from  );
                        // valid = valid && validate('number|nonnegative', v[i].to    );  // NOTE:  not checking this because might be 'Up', which results in NaN. if money parsing was an issue here, it should show on v[i].from or .price
                        valid = valid && validate('number|nonnegative', v[i].price );

                        if(!valid){
                            break;
                        }
                    }
                    return valid;
                },
                getPriceInfo_amazonBased        : function(){
                    
                    return lang.amazonShippingPrices || false;
                },
                validatePriceInfo_amazonBased   : function(v){

                    return  true;
                            
                },

                getAll                          : function(cPricePage){

                    return {
                        priceInfo_weightBased    : priv.parsers.pricePage.getPriceInfo_weightBased   (cPricePage),
                        priceInfo_priceBased     : priv.parsers.pricePage.getPriceInfo_priceBased    (cPricePage),
                        priceInfo_amazonBased    : priv.parsers.pricePage.getPriceInfo_amazonBased   (cPricePage),
                    };
                },
                validateEach                    : function(pricePageData){

                    if(!pricePageData){
                        return false;
                    }

                    return {
                        priceInfo_weightBased      : pricePageData.hasOwnProperty('priceInfo_weightBased')      && priv.parsers.pricePage.validatePriceInfo_weightBased      (pricePageData.priceInfo_weightBased      ),
                        priceInfo_priceBased       : pricePageData.hasOwnProperty('priceInfo_priceBased')       && priv.parsers.pricePage.validatePriceInfo_priceBased       (pricePageData.priceInfo_priceBased       ),
                        priceInfo_amazonBased      : pricePageData.hasOwnProperty('priceInfo_amazonBased')      && priv.parsers.pricePage.validatePriceInfo_amazonBased      (pricePageData.priceInfo_amazonBased      ),
                    };
                },
                validateAll                     : function(pricePageData){

                    var validationData = priv.parsers.pricePage.validateEach(pricePageData);

                    return (
                        validationData                                 && (
                            validationData.priceInfo_weightBased       &&
                            validationData.priceInfo_priceBased        &&
                            validationData.priceInfo_amazonBased
                        ) && (
                            pricePageData.priceInfo_weightBased ||
                            pricePageData.priceInfo_priceBased  ||
                            pricePageData.priceInfo_amazonBased
                        )
                    );
                },

            },

            getPrice                        : function(priceInfo, listingData, productPageData){



                var shippingPrice,
                    totalPrice;

                if(priceInfo.priceInfo_weightBased){




                    shippingPrice     = priceInfo.priceInfo_weightBased.shipment + 
                                        priceInfo.priceInfo_weightBased.item     + 
                                        priceInfo.priceInfo_weightBased.weight * productPageData.weight;
                }
                else if(priceInfo.priceInfo_priceBased){
                    



                    var i;
                    for(i=priceInfo.priceInfo_priceBased.length-1;i>=0;i--){
                        if(priceInfo.priceInfo_priceBased[i].from < listingData.price){
                            break;
                        }
                    }
                    shippingPrice     = priceInfo.priceInfo_priceBased[i].price;
                }
                else if(listingData.hasAmazonShipping && priceInfo.priceInfo_amazonBased){




                    shippingPrice     = priceInfo.priceInfo_amazonBased.shipment + 
                                        priceInfo.priceInfo_amazonBased.item     + 
                                        priceInfo.priceInfo_amazonBased.weight * productPageData.weight;

                    if(listingData.price >= priceInfo.priceInfo_amazonBased.free_from){
                        shippingPrice = 0;
                    }

                }

                totalPrice = listingData.price + shippingPrice;

                totalPrice = priv.convertors.convertMoney(totalPrice);

                totalPrice = Math.round(totalPrice*100)/100;

                return totalPrice;
            },

            getLang                         : function(){

                var i;
                for(i in priv.langs){
                    if(priv.langs.hasOwnProperty(i)){
                        if( location.host.indexOf(priv.langs[i].host)>=0 ){
                            return i;
                        }
                    }
                }

                console.log('ERROR!!!! Could not detect language');
                return false;
            },

        };
        priv.convertors = {

            weightToBaseUnity               : function(weightString){

                var p = weightString.split(' ');

                if(p.length !== 2){

                    // console.log('ERROR: could not convert weightToBaseUnity; weight string has wrong number of parts! ['+weightString+']');
                    return 0;
                }
                
                var quantity = p[0];
                var unity    = p[1];
                
                if(unity.toLowerCase() === 'pounds'){
                    return parseFloat(quantity);
                }
                if(unity.toLowerCase() === 'ounces'){
                    return parseFloat(quantity)/16;
                }
                if(unity.toLowerCase() === 'g'){
                    return parseFloat(quantity)/1000;
                }
                if(unity.toLowerCase() === 'grammes'){
                    return parseFloat(quantity)/1000;
                }
                if(unity.toLowerCase() === 'grams'){
                    return parseFloat(quantity)/1000;
                }
                if(unity.toLowerCase() === 'kg'){
                    return parseFloat(quantity);
                }
                    
                // console.log('ERROR: could not convert weightToBaseUnity; unknown unity');
                return 0;
            },

            parseMoney                      : function(s){

                if(s.indexOf('$')>=0){
                    s = s.replace('$', '');
                    s = s.replace(',', '');
                }
                if( s.indexOf('£'       )>=0 ||
                    s.indexOf('&#xA3;'  )>=0 ||
                    s.indexOf('&#xFFFD;')>=0    ){

                    s = s.replace('£',        '');
                    s = s.replace('&#xA3;',   '');
                    s = s.replace('&#xFFFD;', '');
                    s = s.replace(',',        '');
                }
                if(s.indexOf('EUR')>=0){
                    s = s.replace('EUR', '');
                    s = s.replace('.', '');
                    s = s.replace(',', '.');
                }

                return parseFloat( s.trim() );
            },

            convertMoney                     : function(v){

                if(lang.host === 'amazon.com'){
                    // convert dollar to euro
                    v = 0.92 * v;
                }
                if(lang.host === 'amazon.co.uk'){
                    // convert dollar to euro
                    v = 1.42 * v;
                }

                return v;
            },
            formatMoney                     : function(v){

                v = priv.convertors.convertMoney(v);

                return 'EUR '+Math.round(100*v)/100;
            },
        };
        priv.loaders = {

            getNewListingsPage                 : function(productId, pageNum){

                var startIndex = pageNum*10;

                var url = 'http://www.'+lang.host+'/gp/offer-listing/'+productId+'/?ie=UTF8&condition=new&startIndex='+startIndex;

                return new Promise(function(resolve, reject){
                    priv.requestQueue.push(
                        url,
                        1,
                        function(err, pageBody){

                            if(err){
                                reject(err);
                                return;
                            }

                            resolve(
                                cheerio.load(pageBody)
                            );
                        }
                    );
                }).then(
                    priv.validators.chainedPageValidatorFactory(priv.parsers.listingsPage , 'listingsPage')
                );
            },
            getNewListingsFirstPage            : function(productId){

                return priv.loaders.getNewListingsPage(productId, 0);
            },
            getNewListingsPages                : function(productId, fromPage, toPage, onEach){

                fromPage = fromPage || 1;
                onEach   = onEach   || function(a){return a;};

                var i,
                    promises = [];
                for(i=fromPage;i<toPage;i++){

                    promises.push(
                        priv.loaders.getNewListingsPage(productId, i).then(onEach)      // TODO: error handling
                    );
                }


                return Promise.all(promises);
            },

            getListingPricePage                : function(productId, sellerId){
                
                var url = 'http://www.'+lang.host+'/gp/aag/details/?asin='+productId+'&seller='+sellerId+'&sshmPath=shipping-rates';

                return new Promise(function(resolve, reject){
                    priv.requestQueue.push(
                        url,
                        2,
                        function(err, pageBody){

                            if(err){
                                reject(err);
                                return;
                            }

                            resolve(
                                cheerio.load(pageBody)
                            );
                        }
                    );
                }).then(
                    priv.validators.chainedPageValidatorFactory(priv.parsers.pricePage , 'pricePage')
                );
            },
            getListingPricePages               : function(productId, cListings, onEach){
                    
                onEach   = onEach   || function(a){return a;};
                

                // build shipping details url array
                var i,
                    promises = [],
                    listingData;
                for(i=0;i<cListings.length;i++){


                    listingData = priv.parsers.listing.getAll(cListings.eq(i));

                    if(!listingData.hasAmazonShipping && listingData.hasInternationalShipping){

                        promises.push(
                            priv.loaders.getListingPricePage(productId, listingData.sellerId)
                                .then((function(listingData){
                                        return function(cListingPricePage){
                                            return onEach(
                                                cListingPricePage,
                                                listingData
                                            );
                                        };
                                    }(listingData))
                                )
                        );
                    }
                    else if(listingData.hasAmazonShipping && !listingData.isPrimeOnly){
                        
                        promises.push(
                            new Promise.resolve()
                                .then((function(listingData){
                                        return function(){
                                            return onEach(
                                                cheerio.load('<div></div>'),
                                                listingData
                                            );
                                        };
                                    }(listingData))
                                )
                        );
                    }

                }

                return Promise.all(promises);
            },

            getProductPage                     : function(productId){

                var url = 'http://www.'+lang.host+'/gp/product/'+productId+'/?ie=UTF8';

                return new Promise(function(resolve, reject){
                    priv.requestQueue.push(
                        url,
                        1,
                        function(err, pageBody){

                            if(err){
                                reject(err);
                                return;
                            }

                            resolve(
                                cheerio.load(pageBody)
                            );
                        }
                    );
                }).then(
                    priv.validators.chainedPageValidatorFactory(priv.parsers.productPage , 'productPage')
                );
            },
        };

        priv.validators = {

            chainedPageValidatorFactory : function(parserGroup, pageName){

                pageName = pageName || '_no_name_';

                return function(cPage){

                    var parsed = parserGroup.getAll(cPage);

                    if(!parserGroup.validateAll( parsed ) ){

                        var validationData = parserGroup.validateEach(parsed);


                        var file = './test/validation.'+pageName+'.'+lang.domain+'.html';

                        console.error('Validation error ['+pageName+']: writing page source to ['+file+'].');
                        console.error('Parsed values: ',     parsed);
                        console.error('Validation values: ', validationData);


                        return fs.writeFileAsync(file, cPage.root().html())
                            .catch(function(){

                                console.log('Error writing to file: ['+file+']');

                                return Promise.reject();
                            })
                            .then(function() {

                                return Promise.reject();
                            }); 
                    }
                    return Promise.resolve(cPage);
                };
            },
        };


        priv.getById = function(productId){

            var vendorPrices = [];


            return Promise.all([

                priv.loaders.getProductPage         (productId) .then(priv.parsers.productPage .getAll),
                priv.loaders.getNewListingsFirstPage(productId) .then(priv.parsers.listingsPage.getAll),

            ])
            .spread(function(productPageData, firstListingsPageData){

                if(productPageData.exists !== firstListingsPageData.exists){

                    console.log('ERROR : Something is wrong in exists validation!');
                    console.log('productPageData.exists       : ', productPageData.exists);
                    console.log('firstListingsPageData.exists : ', firstListingsPageData.exists);


                    priv.progressNotifier.addNumTick(1);

                    Promise.all([

                        priv.loaders.getProductPage         (productId),
                        priv.loaders.getNewListingsFirstPage(productId),

                    ]).spread(function(cProductPage, cListingsPage){


                        var file = './test/badExistMatch.productPage.'+lang.domain+'.html';

                        fs.writeFileAsync(file, cProductPage.root().html())
                            .catch(function(){

                                console.log('Error writing to file: ['+file+']');
                            }); 

                        var file2 = './test/badExistMatch.listingsPage.'+lang.domain+'.html';

                        fs.writeFileAsync(file2, cListingsPage.root().html())
                            .catch(function(){

                                console.log('Error writing to file: ['+file+']');
                            }); 


                        priv.progressNotifier.tick();

                    });

                    return Promise.reject();
                }
                if(!productPageData.exists || !firstListingsPageData.exists){

                    return Promise.resolve(false);
                }

                var handleListings = function(listings){

                    priv.progressNotifier.addNumTicks(listings.length);

                    return priv.loaders.getListingPricePages(productId, listings, function(pricePage, listingData){

                        priv.progressNotifier.tick();

                        var listingPricePageData = priv.parsers.pricePage.getAll(pricePage);

                        var price = priv.parsers.getPrice(listingPricePageData, listingData, productPageData);

                        if(price){

                            var vendorPrice = {
                                sellerId    : listingData.sellerId,
                                price       : price,
                            };

                            vendorPrices.push(vendorPrice);
                        }
                    });
                };


                if(firstListingsPageData.numPages === 1){

                    return handleListings(firstListingsPageData.cListings);
                }



                priv.progressNotifier.addNumTicks(firstListingsPageData.numPages - 1);


                return Promise.all([

                    handleListings(firstListingsPageData.cListings),

                    priv.loaders.getNewListingsPages(productId, 1, firstListingsPageData.numPages, function(listingsPage){

                        priv.progressNotifier.tick();

                        var listingsData = priv.parsers.listingsPage.getAll(listingsPage);

                        return handleListings(listingsData.cListings);

                    })
                ]);
                
            }).then(function(){

                vendorPrices.sort(function(a,b){return a.price-b.price;});
                // console.log('vendorPrices : ', vendorPrices);
                
                priv.progressNotifier.tick();

                return vendorPrices;
            }).catch(function(e){
                console.log('ERROR in getById(): ', e);
            });
        };

        publ.get      = priv.getById;

        publ.parsers  = priv.parsers;
        publ.loaders  = priv.loaders;

        publ.progress = priv.progressNotifier;

        return publ;
    };








    // export main controller
    module.exports = function(){

        var publ = {};


        publ.get = function(productId){


            publ.progress = ProgressNotifier();


            var hostPromises = [];


            // setup loades & progress-notifiers per lang/host
            var host,
                pg;
            for(host in langs){
                if(langs.hasOwnProperty(host)){

                    pg = AmazonPriceGetter(langs[host]);

                    hostPromises.push(pg.get(productId));

                    if(progressNotifier){
                        progressNotifier.addChild(pg.progress);
                    }
                }
            }

            // return loader promise & handle global results
            return Promise.settle(hostPromises).then(function(hostResults){


                // re-arrange results arrays into object with sorted results per lang/host name
                var resultsPerLang =  {},
                    host,
                    hostResult,
                    c = 0;
                for(host in langs){
                    if(langs.hasOwnProperty(host)){

                        if(hostResults[c].isFulfilled() ){

                            hostResult = hostResults[c].value();

                            if(hostResult){

                                resultsPerLang[host] = hostResult;
                            }
                        }

                        c++;
                    }
                }

                if(progressNotifier){
                    progressNotifier.tick();
                }

                return resultsPerLang;

            });
        };

        return publ;
    };



}());