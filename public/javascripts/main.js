var handleError = function(xhr) {
    if (xhr.responseJSON && xhr.responseJSON.msg) {
        alert(xhr.responseJSON.msg);
    } else {
        alert(xhr.responseText);
    }
    $(".standbyComponent").addClass("hidden");
    console.error(xhr);
};

$(".mainButton.deleteAccountButton").click(function(button) {
    var billingItem, account, account_key = this.id;
    $(this).attr("class").split(" ").forEach(function(className) {
        if(className.indexOf("billingItem") !== -1) {
            billingItem = className.split("billingItem")[1];
        } else if(className.indexOf("_account") !== -1) {
            account = className.split("_account")[1];
        }
    });
    if(window.confirm("Are you sure you want to delete this account?") === true) {
        console.info(window.location.pathname + "/account/" + billingItem);
        $.ajax({
            dataType: "json",
            cache: false,
            type: "DELETE",
            error: handleError,
            data : {account_key : account_key, account_name: account},
            url: window.location.pathname + "/account/" + billingItem
        }).then(function(data) {
            location.reload();
        });
    }     
});
$(".mainButton.refreshButton").click(function() {
    $(".standbyComponent").toggleClass("hidden");
    $.ajax({
        dataType: "json",
        cache: false,
        type: "POST",
        error: handleError,
        url: window.location.pathname + "/action/refresh"
    }).then(function(data) {
        location.reload();
    });
});
var renderTimestamp = function() {
    var classes = $(".objectStorageUI .timestamp .timestampValue"), date, now = new Date(), msecs, string, value = "";
    if (!classes || classes.length === 0) {
        return false; 
    }
    classes = classes[0].className;
    date = new Date(parseInt(classes.split(" ")[1], 10));
    msecs = now.getTime() - date.getTime();
    if (msecs > (1000 * 60)) {
        value = (msecs / (1000 * 60)).toFixed(0);
        string = value > 1 ? " minutes ago" : " minute ago";
    } else {
        string = "Less than a minute ago";
    }
    var minutes = msecs / (1000 * 60);
    $(".objectStorageUI .timestamp .timestampValue").html(value + string);
    return true;
};

var currentUsage = {
    unit: "usage_gb",
    time: "time_30_days"
};
var fakeUsageX = [ "1415466710675", "1415553110675", "1415639510675", "1415725910675", "1415812310675",
    "1415898710675", "1415985110675", "1416071510675", "1416157910675" ];
var fakeUsageY = [ 2, 4, 10, 30, 22, 22, 50, 70, 72 ];
var date = new Date();
var msecsInDay = 86400000;
var date30DaysAgo = new Date(date.getTime() - 30 * msecsInDay);
var date7DaysAgo = new Date(date.getTime() - 7 * msecsInDay);

var binaryIndexOf = function(array, searchElement) {
    var minIndex = 0, maxIndex = array.length - 1, currentIndex, currentElement;

    while (minIndex <= maxIndex) {
        currentIndex = (minIndex + maxIndex) / 2 | 0;
        currentElement = array[currentIndex];

        if (currentElement < searchElement) {
            minIndex = currentIndex + 1;
        } else if (currentElement > searchElement) {
            maxIndex = currentIndex - 1;
        } else {
            return currentIndex;
        }
    }
    return -1;
};
var transformGBintoMB = function(gb_array) {
    var mb_array = [];
    for ( var i = 0; i < gb_array.length; i++) {
        mb_array.push(gb_array[i] * 1024);
    }
    return mb_array;
};
var generateDataAxis = function(dateArray, usageArray) {
    var dataAxisArray = [], date, dateStr;
    for ( var i = 0; i < dateArray.length; i++) {
        date = new Date(parseInt(dateArray[i], 10));
        dateStr = date.getYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate();
        dataAxisArray.push({
            date: dateStr,
            usage: usageArray[i]
        });
    }
    return dataAxisArray;
};
var drawGraph = function(dates, usageData) {
    var data, minMsecs, x, y;
    console.info("HEY drawGraph");
    x = dates.slice(0);
    y = usageData.slice(0);
    console.info("HEY drawGraph2");
    if (currentUsage.time = "time_30_days") {
        minMsecs = date30DaysAgo.getTime();
    } else if (currentUsage.time = "time_7_days") {
        minMsecs = date7DaysAgo.getTime();
    } else {
        minMsecs = date7DaysAgo.getTime(); //figure out 1 day        
    }
    console.info(currentUsage.time);
    console.info(x);
    console.info(y);
    for ( var i = 0; i < fakeUsageX.length; i++) {
        if (fakeUsageX[i] >= minMsecs) {
            x.splice(0, i);
            y.splice(0, i);
            break;
        }
    }

    console.info(x);
    console.info(y);
    if (currentUsage.unit === "usage_mb") {
        y = transformGBintoMB(y);
    }
    console.info(x);
    console.info(y);
    data = generateDataAxis(x, y);
    console.info(data);
    //generateSwiftUsageChart(data);
};
var graphDropdownClicked = function(element) {
    var selectedId = element.firstChild.id;
    console.info(element);
    console.info(selectedId);
    console.info(currentUsage);

    var type = selectedId.indexOf("usage_") !== -1 ? "unit" : "time";
    console.info(type);
    if (currentUsage[type] === selectedId) {
        return;
        console.info(type);
    }
    currentUsage[type] = selectedId;
    console.info(currentUsage);
    drawGraph(fakeUsageX, fakeUsageY);
};

$(document).ready(function() {
    //$(".infoTile .tileContent table").toggleClass("heythere");
    $(".infoTile .tileContent table").tablesorter({
        sortList: [ [ 0, 0 ], [ 1, 0 ] ]
    });
    //drawGraph(fakeUsageX, fakeUsageY);
    if(renderTimestamp()) {
        setInterval(renderTimestamp, 60000);        
    }
});
