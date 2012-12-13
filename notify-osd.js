/*global window: false, document: false */

(function ($) {
  "use strict";

  var defaults = {
    text             : '',
    icon             : '',
    timeout          : 5,
    sticky           : false,
    dismissable      : false,
    click_through    : true,
    buffer           : 40,
    opacity_max      : 0.85,
    opacity_min      : 0.20,
    spacing          : 20,
    visible_max      : 3
  };

  // helper objects
  var Point = function (x,y) {
    return {
      x : x,
      y : y,
      lies_inside : function (region) {
        return ((this.y > region.top) && (this.y < region.bottom) && (this.x > region.left) && (this.x < region.right));
      },
      min_distance_in : function (region) {
        var rel_position = {
          top    : Math.abs(this.y - region.top),
          right  : Math.abs(this.x - region.right),
          bottom : Math.abs(this.y - region.bottom),
          left   : Math.abs(this.x - region.left)
        };
        var min = rel_position.left;
        if (rel_position.top < min) {
          min = rel_position.top;
        }
        if (rel_position.right < min) {
          min = rel_position.right;
        }
        if (rel_position.bottom < min) {
          min = rel_position.bottom;
        }
        return min;
      },
      to_string : function () { return "x: "+this.x+" y: "+this.y; }
    };
  };

  var Region = function (data) {
    var r = {
      update : function (data) {
        this.top    = data.top;
        this.left   = data.left;
        this.width  = data.width;
        this.height = data.height;
        this.bottom = data.top + data.height;
        this.right  = data.left + data.width;
      },
      to_string : function () { return "t: "+this.top+" l: "+this.left+" h: "+this.height+" w: "+this.width; }
    };

    r.update(data);
    return r;
  };

  var PriorityQueue = function (events) {
    var q = [];
    return {
      events : events,
      first : function () { return q[0]; },
      last : function () { return q[q.length - 1]; },
      clear : function () { q.length = 0; },
      indexOf : function (x) { return $.inArray(x, q); },
      enqueue : function (x) {
        var last = this.last();
        q.push(x);
        if (last) {
          last.below = x;
          x.above = last;
        }
        // alert subscribers of the event 'events.enqueue'
        events.enqueue && $(document).trigger(events.enqueue);
      },
      extract : function (i) {
        var x_above = q[i-1];
        var x_below = q[i+1];
        var x = q.splice(i, 1)[0];
        if (x_above) {
          x_above.below = x_below;
        }
        if (x_below) {
          x_below.above = x_above;
        }
        // alert subscribers of the event 'events.extract'
        events.extract && $(document).trigger({ 'type': events.extract, 'extracted': x });
        return x;
      },
      dequeue : function () {
        return this.extract(0);
      },
      length : function () {
        return q.length;
      }
    };
  };

  // notification queues
  var notifs = {
    visible : new PriorityQueue({ enqueue: 'notif_display', extract: 'notif_removed' }), // queue of currently-visible notifications
    queued : new PriorityQueue({ enqueue: 'notif_created' }) // queue of yet-to-be-displayed notifications
  };

  // bind subscriber event handlers for handling notifications
  // new notification is created and enqueued
  var display_next_notif = function () {
    if (notifs.visible.length() < defaults.visible_max && notifs.queued.length() > 0) {
      var notif_obj = notifs.queued.dequeue();
      notifs.visible.enqueue(notif_obj);
    }
  };
  $(document).bind(notifs.queued.events.enqueue, display_next_notif);
  // oldest-queued notification is to be displayed on page
  $(document).bind(notifs.visible.events.enqueue, function (evt) {
    var notif_obj = notifs.visible.last();
    var above = notif_obj.above;
    var notif_obj_top = defaults.spacing;
    if (above) {
      notif_obj_top += above.offset().top + above.height();
    }
    $(notif_obj).css('top', notif_obj_top);
    notif_obj.display();
  });
  // a notification is removed ("extracted") from the page
  $(document).bind(notifs.visible.events.extract, function (evt) {
    var extracted = evt.extracted;
    // if there are any visible notifications below the extracted one ...
    if (extracted.below !== undefined) {
      // ... move them up ...
      extracted.reposition_below(function () {
        // ... and display the next queued notification *after* all notifications have finished repositioning ...
        display_next_notif();
      });
    } else {
      // ... but if there aren't any below, then just display the next one directly
      display_next_notif();
    }

    // remove it from the DOM
    extracted.remove();
  });

  // user-facing notification API
  var reposition_count = 0; // to keep track of how many notifications are done repositioning after one of them is dismissed
  $.notify_osd = {
    defaults : defaults,
    create : function (options) {
      var opts = $.extend({}, defaults, options);
      var mouse, notification, buffer;

      notification = new Region({});
      buffer = new Region({});

      var notif_obj = $('<div class="notify-osd"><div><table><tr><td class="notify-osd-content">'+opts.text+'</td></tr></table></div></div>').css({
        'opacity' : opts.opacity_max
      }).hide();

      notif_obj.extend({
        opts : opts,
        set_text : function (text) {
          $(this).find('.notify-osd-content').html(text);
          return this;
        },
        set_icon : function (src) {
          if (src !== '') {
            $(this).find('tr').prepend('<td class="notify-osd-icon"><img src="'+src+'" /></td>');
          } else {
            $(this).find('.notify-osd-icon').remove();
          }
          return this;
        },

        set_dismissable : function (dismissable) {
          if (opts.dismissable || opts.sticky) {
            $(this).children('div').append('<a href="#" class="notify-osd-dismiss" title="Dismiss">&times;</a>');
            $(this).find('.notify-osd-dismiss').unbind('click').click(function () {
              notif_obj.dismiss();
            });
          } else {
            $(this).find('.notify-osd-dismiss').unbind('click').remove();
          }
          return this;
        },

        set_click_through : function (click_through) {
          var pointer_events = click_through ? 'none' : 'auto';
          $('.notify-osd').css('pointer-events', pointer_events);

          // ensure dismiss button is always clickable
          $('.notify-osd .notify-osd-dismiss').css('pointer-events', 'auto');
        },

        update_regions : function () {
          // update notification and buffer regions
          notification.update({
            top    : notif_obj.offset().top,
            left   : notif_obj.offset().left,
            width  : notif_obj.width(),
            height : notif_obj.height()
          });
          buffer.update({
            top    : notification.top    - opts.buffer,
            left   : notification.left   - opts.buffer,
            width  : notification.width  + 2 * opts.buffer,
            height : notification.height + 2 * opts.buffer
          });
        },

        display : function () {
          this.set_text(opts.text).set_icon(opts.icon).set_dismissable(opts.dismissable);

          $(this).appendTo('body').fadeIn('fast', function () {
            notif_obj.update_regions();

            window.clearTimeout(notif_obj.timeout);
            notif_obj.timeout = (!opts.sticky && opts.timeout) ? window.setTimeout(function () { notif_obj.dismiss(); },opts.timeout*1000) : null;
            mouse = new Point(0, 0);

            notif_obj.set_click_through(opts.click_through);

            $(document).mousemove(notif_obj.mousemove);
          });

          return this;
        },

        translate : function (move, max_count, callback) {
          var notif_obj_top = notif_obj.offset().top - move.up;
          notif_obj.animate({
            'top' : notif_obj_top
          }, 'fast', function () {
            notif_obj.update_regions();

            reposition_count++;
            // check if this was the last notification to be repositioned
            if (reposition_count === max_count) {
              callback();
            }
          });
        },

        reposition_below : function (callback) {
          // callback will be called once ALL notifications have FINISHED repositioning
          var notif = notif_obj.below;
          var max_count = 0;
          reposition_count = 0;
          while (notif !== undefined) {
            max_count++;
            notif = notif.below;
          }

          var notif = notif_obj.below;
          while (notif !== undefined) {
            notif.translate({ up: notif_obj.height() + defaults.spacing }, max_count, callback);
            notif = notif.below;
          }
        },

        dismiss : function () {
          $(document).unbind('mousemove', notif_obj.mousemove);
          $(this).fadeOut('fast', function () {
            var notif_obj_index = notifs.visible.indexOf(notif_obj);
            if (notif_obj_index >= 0) {
              notifs.visible.extract(notif_obj_index);
            }
          });
        },

        mousemove : function (e) {
          mouse.x = e.pageX - $('body').scrollLeft();
          mouse.y = e.pageY - $('body').scrollTop();

          var opacity;
          if (mouse.lies_inside(buffer)) {
            // find the minimum distance of the mouse from the edges of the buffer region
            var min_distance = mouse.min_distance_in(buffer);
            if (mouse.lies_inside(notification)) {
              opacity = opts.opacity_min;
            } else {
              opacity = opts.opacity_max - (opts.opacity_max-opts.opacity_min) * (min_distance/opts.buffer);
            }
          } else {
            opacity = opts.opacity_max;
          }

          notif_obj.css('opacity', opacity);
        }
      });

      notifs.queued.enqueue(notif_obj);

      return notif_obj;
    },
    setup : function (options) {
      defaults = $.extend({}, defaults, options);
    },
    dismiss : function () {
      notifs.queued.clear();
      var notif = notifs.visible.first();
      while (notif !== undefined) {
        notif.dismiss();
        notif = notif.below;
      }
    }
  };
}(jQuery));
