// ==UserScript==
// @name        Import CD1D releases to MusicBrainz
// @description Add a button on CD1D.com release pages allowing to open MusicBrainz release editor with pre-filled data for the selected release
// @namespace   http://userscripts.org/users/517952
// @include     http://1d-aquitaine.com/*/album/*
// @include     http://1d-midipyrenees.com/*/album/*
// @include     http://1d-paca.com/*/album/*
// @include     http://1d-paysdelaloire.com/*/album/*
// @include     http://1d-rhonealpes.com/*/album/*
// @include     http://cd1d.com/*/album/*
// @version     2015.06.17.1
// @downloadURL https://raw.github.com/murdos/musicbrainz-userscripts/master/cd1d_importer.user.js
// @updateURL   https://raw.github.com/murdos/musicbrainz-userscripts/master/cd1d_importer.user.js
// @require     https://ajax.googleapis.com/ajax/libs/jquery/2.1.4/jquery.min.js
// @require     lib/mbimport.js
// @require     lib/logger.js
// @require     lib/mbimportstyle.js
// ==/UserScript==

/* Import releases from http://cd1d.com to MusicBrainz */
if (!unsafeWindow) unsafeWindow = window;

// prevent JQuery conflicts, see http://wiki.greasespot.net/@grant
this.$ = this.jQuery = jQuery.noConflict(true);

var CD1DImporter = {

  getFormats: function () {
    // get a list of existing formats, return id of the fragment and name
    var formats = $('#container-1 ul li.ui-state-default').map(function () {
      return {
        id: $(this).find('a:first').attr('href').split('#')[1].split('-'),
        name: $(this).find('span:first').text()
      };
    });
    // remove "parent" formats : ie. digital when mp3 and flac are present
    for (var i = 0; i < formats.length; i++) {
      for (var j = i + 1; j < formats.length; j++) {
        if (formats[j].id.length > 1) {
          if (formats[i].id[1] == formats[j].id[1]) {
            // same prefix (ie. fragment-33123 and fragment-33123-1-2)
            if (formats[i].id.length < formats[j].id.length) {
              formats[i].toremove = true;
            } else if (formats[i].id.length > formats[j].id.length) {
              formats[j].toremove = true;
            }
          }
        }
      }
    }
    var cleanformats = [];
    for (var i = 0; i < formats.length; i++) {
      if (!formats[i].toremove) {
        cleanformats.push({
          id: formats[i].id.join('-'),
          name: formats[i].name
        });
      }
    }
    return cleanformats;
  },

  getTracks: function (id) {
    // extract discs & tracks
    var tracklists = 'div#' + id + ' div.tracklist table.tracklist-content';
    var discs = [];
    $(tracklists).each(function () {
      disc = $(this).find('tbody tr').map(function () {
        // $(this) is used more than once; cache it for performance.
        var row = $(this);

        // For each row that's "mapped", return an object that
        //  describes the first and second <td> in the row.
        var duration = row.find('td.tracklist-content-length').text().replace('"', '').replace('\' ', ':')

        // drop track number prefix (A A2 C3 01 05 etc...)
        var title = row.find('td.tracklist-content-title').text().replace(/^[0-9A-F][0-9]* /, '');
        return {
          title: title,
          duration: MBImport.hmsToMilliSeconds(duration)
        };
      }).get();
      discs.push(disc);
    });
    return discs;
  },

  getArtists: function () {
    // get artists
    var artists = $('div.infos-releasegrp div.list-artist a').map(function () {
      return $(this).text();
    }).get();
    return MBImport.makeArtistCredits(artists);
  },

  getAlbum: function () {
    // get release title
    return $('h1').text();
  },

  fromCurrentTime: function (offset_in_seconds) {
    var millis = Date.now();
    if (!isNaN(offset_in_seconds)) {
      millis += offset_in_seconds * 1000;
    }
    var date = new Date(millis);
    var dd = date.getDate();
    var mm = date.getMonth() + 1; //January is 0!
    var yyyy = date.getFullYear();
    return {
      'year': yyyy,
      'month': mm,
      'day': dd
    };
  },

  getReleaseDate: function () {
    // get release date and convert it to object
    var text = $('div.infos-releasegrp div.row-date').text();
    if (text == 'yesterday' || text == 'hier') {
      return this.fromCurrentTime(-24 * 60 * 60);
    }
    if (text == 'today' || text == 'aujourd\'hui') {
      return this.fromCurrentTime(0);
    }
    var date = text
      .replace('janvier', '01')
      .replace('février', '02')
      .replace('mars', '03')
      .replace('avril', '04')
      .replace('mai', '05')
      .replace('juin', '06')
      .replace('juillet', '07')
      .replace('août', '08')
      .replace('septembre', '09')
      .replace('octobre', '10')
      .replace('novembre', '11')
      .replace('décembre', '12')
      .replace('January', '01')
      .replace('February', '02')
      .replace('March', '03')
      .replace('April', '04')
      .replace('May', '05')
      .replace('June', '06')
      .replace('July', '07')
      .replace('August', '08')
      .replace('September', '09')
      .replace('October', '10')
      .replace('November', '11')
      .replace('December', '12')
      .split(' ');
    return {
      'year': parseInt(date[2], 10),
      'month': parseInt(date[1], 10),
      'day': parseInt(date[0], 10)
    };
  },

  currentURL: function () {
    return window.location.href.replace(/\/[a-z]{2}\/album\//i, '/album/').split('#')[0];
  },

  retrieveReleaseInfo: function (format) {
    // Analyze CD1D data and return a release object
    var release = {
      artist_credit: this.getArtists(),
      title: this.getAlbum(),
      country: "", // Worldwide
      type: '',
      status: 'official',
      language: 'eng',
      script: 'latn',
      barcode: '',
      urls: [],
      discs: [],
    };

    // Grab release event information
    var releasedate = this.getReleaseDate();
    release.year = releasedate.year;
    release.month = releasedate.month;
    release.day = releasedate.day;

    var link_type = MBImport.URL_TYPES;

    if (format.name.match(/vinyl|lp/i)) {
      release.country = 'FR';
      release.format = "Vinyl";
      release.urls.push({
        'url': this.currentURL(),
        'link_type': link_type.purchase_for_mail_order
      });
    } else if (format.name.match(/cd/i)) {
      release.country = 'FR';
      release.format = 'CD';
      release.urls.push({
        'url': this.currentURL(),
        'link_type': link_type.purchase_for_mail_order
      });
    } else if (format.name.match(/digital|mp3|flac|ogg|wav/i)) {
      release.country = 'XW';
      release.packaging = 'None';
      release.format = "Digital Media";
      release.urls.push({
        'url': this.currentURL(),
        'link_type': link_type.purchase_for_download
      });
    }

    release.labels = $('div.infos-details div.row-structure').map(function () {
        return {
          name: $(this).text(),
          mbid: '',
          catno: 'none'
        };
      })
      .get();

    // Tracks
    $.each(this.getTracks(format.id), function (ndisc, disc) {
      var thisdisc = {
        tracks: [],
        format: release.format
      };
      release.discs.push(thisdisc);
      $.each(this, function (ntrack, track) {
        thisdisc.tracks.push({
          'title': track.title,
          'duration': track.duration,
          'artist_credit': []
        });
      });
    });

    LOGGER.info("Parsed release: ", format.name, release);
    return release;
  },

  insertLink: function (release, where, formatname) {
    // Insert links in page

    // Form parameters
    var edit_note = MBImport.makeEditNote(this.currentURL(), 'CD1D', formatname);
    var parameters = MBImport.buildFormParameters(release, edit_note);

    // Build form
    var mbUI = $('<div id="mb_buttons">'
      + MBImport.buildFormHTML(parameters)
      + MBImport.buildSearchButton(release)
      + '</div>').hide();
    $(where).append(mbUI);
    $('#mb_buttons').css({'margin-top': '6px'});
    $('form.musicbrainz_import').css({display: 'inline-block', 'margin-right': '5px'});
    mbUI.slideDown();
  }
};

$(document).ready(function () {
  MBImportStyle();
  /* CD1D uses same page with hidden tabs for all formats */
  var formats = CD1DImporter.getFormats();
  //LOGGER.info('Formats:', formats);

  for (var i = 0; i < formats.length; i++) {
    var release = CD1DImporter.retrieveReleaseInfo(formats[i]);
    CD1DImporter.insertLink(release, 'div#' + formats[i].id, formats[i].name);
  }
});
