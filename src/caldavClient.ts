import { requestUrl } from 'obsidian';
import { CalendarEvent, EventCategory, FeishuSettings } from './types';

const CALDAV_SERVER = 'https://caldav.feishu.cn';

export class CalDavClient {
  private settings: FeishuSettings;
  private categoryKeywords: Record<EventCategory, string[]>;

  constructor(settings: FeishuSettings, categoryKeywords: Record<EventCategory, string[]>) {
    this.settings = settings;
    this.categoryKeywords = categoryKeywords;
  }

  updateSettings(settings: FeishuSettings, categoryKeywords: Record<EventCategory, string[]>) {
    this.settings = settings;
    this.categoryKeywords = categoryKeywords;
  }

  // Get events for a date range using CalDAV REPORT
  async getEvents(startTime: Date, endTime: Date): Promise<CalendarEvent[]> {
    if (!this.settings.caldavUsername || !this.settings.caldavPassword) {
      throw new Error('请先配置 CalDAV 用户名和密码');
    }

    const auth = btoa(`${this.settings.caldavUsername}:${this.settings.caldavPassword}`);

    // First, discover the calendar URL
    const calendarUrl = await this.discoverCalendar(auth);
    if (!calendarUrl) {
      throw new Error('未找到日历，请检查 CalDAV 配置');
    }

    console.log('[Focus Planner] CalDAV calendar URL:', calendarUrl);

    // Then fetch events using calendar-query REPORT
    const events = await this.fetchEventsFromCalendar(calendarUrl, auth, startTime, endTime);

    console.log('[Focus Planner] CalDAV fetched events:', events.length);
    return events;
  }

  // Discover the user's calendar URL
  private async discoverCalendar(auth: string): Promise<string | null> {
    // First, get the principal URL
    const propfindBody = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:current-user-principal/>
  </d:prop>
</d:propfind>`;

    try {
      const response = await requestUrl({
        url: CALDAV_SERVER,
        method: 'PROPFIND',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/xml; charset=utf-8',
          'Depth': '0',
        },
        body: propfindBody,
        throw: false,
      });

      console.log('[Focus Planner] CalDAV PROPFIND response:', response.status);

      if (response.status === 401) {
        throw new Error('CalDAV 认证失败，请检查用户名和密码');
      }

      if (response.status !== 207) {
        throw new Error(`CalDAV 请求失败: ${response.status}`);
      }

      // Parse the principal URL from response
      const principalMatch = response.text.match(/<d:current-user-principal>[\s\S]*?<d:href>([^<]+)<\/d:href>/i);
      if (!principalMatch) {
        console.log('[Focus Planner] CalDAV response:', response.text);
        throw new Error('无法获取用户主体 URL');
      }

      const principalUrl = principalMatch[1];
      console.log('[Focus Planner] Principal URL:', principalUrl);

      // Get calendar home set
      const calendarHomeUrl = await this.getCalendarHome(principalUrl, auth);
      if (!calendarHomeUrl) {
        throw new Error('无法获取日历主目录');
      }

      console.log('[Focus Planner] Calendar home URL:', calendarHomeUrl);

      // Get the default calendar
      const calendarUrl = await this.getDefaultCalendar(calendarHomeUrl, auth);
      return calendarUrl;
    } catch (e) {
      console.error('[Focus Planner] CalDAV discovery error:', e);
      throw e;
    }
  }

  // Get the calendar home set URL
  private async getCalendarHome(principalUrl: string, auth: string): Promise<string | null> {
    const fullUrl = principalUrl.startsWith('http') ? principalUrl : `${CALDAV_SERVER}${principalUrl}`;

    const propfindBody = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <c:calendar-home-set/>
  </d:prop>
</d:propfind>`;

    const response = await requestUrl({
      url: fullUrl,
      method: 'PROPFIND',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/xml; charset=utf-8',
        'Depth': '0',
      },
      body: propfindBody,
      throw: false,
    });

    if (response.status !== 207) {
      console.error('[Focus Planner] Calendar home PROPFIND failed:', response.status, response.text);
      return null;
    }

    const homeMatch = response.text.match(/<c:calendar-home-set>[\s\S]*?<d:href>([^<]+)<\/d:href>/i) ||
                      response.text.match(/<cal:calendar-home-set>[\s\S]*?<d:href>([^<]+)<\/d:href>/i);
    if (!homeMatch) {
      console.log('[Focus Planner] Calendar home response:', response.text);
      return null;
    }

    return homeMatch[1];
  }

  // Get the default calendar URL
  private async getDefaultCalendar(homeUrl: string, auth: string): Promise<string | null> {
    const fullUrl = homeUrl.startsWith('http') ? homeUrl : `${CALDAV_SERVER}${homeUrl}`;

    const propfindBody = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:resourcetype/>
    <d:displayname/>
  </d:prop>
</d:propfind>`;

    const response = await requestUrl({
      url: fullUrl,
      method: 'PROPFIND',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/xml; charset=utf-8',
        'Depth': '1',
      },
      body: propfindBody,
      throw: false,
    });

    console.log('[Focus Planner] Calendar list PROPFIND status:', response.status);
    console.log('[Focus Planner] Calendar list response preview:', response.text.substring(0, 1000));

    if (response.status !== 207) {
      console.error('[Focus Planner] Calendar list PROPFIND failed:', response.status);
      // 飞书可能直接在 home URL 提供日历，不需要子目录
      return homeUrl;
    }

    // Find calendar collections - look for <c:calendar/> or <cal:calendar/> in resourcetype
    const calendarMatches = response.text.matchAll(/<d:response>[\s\S]*?<d:href>([^<]+)<\/d:href>[\s\S]*?<d:resourcetype>[\s\S]*?(?:<c:calendar|<cal:calendar)[^>]*\/?>/gi);

    const calendars: string[] = [];
    for (const match of calendarMatches) {
      const href = match[1];
      // Skip the home URL itself
      if (href !== homeUrl && href.length > homeUrl.length) {
        console.log('[Focus Planner] Found calendar:', href);
        calendars.push(href);
      }
    }

    if (calendars.length > 0) {
      return calendars[0];
    }

    // Try alternative: look for any href that's not the home URL
    const allHrefs = response.text.matchAll(/<d:href>([^<]+)<\/d:href>/gi);
    for (const match of allHrefs) {
      const href = match[1];
      if (href !== homeUrl && href.startsWith(homeUrl) && href.length > homeUrl.length) {
        console.log('[Focus Planner] Found potential calendar URL:', href);
        return href;
      }
    }

    // 飞书可能直接在 home URL 提供日历
    console.log('[Focus Planner] No sub-calendars found, using home URL as calendar');
    return homeUrl;
  }

  // Fetch events from a calendar
  // Try calendar-query REPORT first, fall back to PROPFIND + individual GET
  private async fetchEventsFromCalendar(
    calendarUrl: string,
    auth: string,
    startTime: Date,
    endTime: Date
  ): Promise<CalendarEvent[]> {
    const fullUrl = calendarUrl.startsWith('http') ? calendarUrl : `${CALDAV_SERVER}${calendarUrl}`;

    // Try calendar-query REPORT first
    const reportEvents = await this.tryCalendarQueryReport(fullUrl, auth, startTime, endTime);
    if (reportEvents !== null) {
      return reportEvents;
    }

    // Fallback: Use PROPFIND to list .ics files, then GET each one
    console.log('[Focus Planner] REPORT not supported, falling back to PROPFIND + GET');
    return await this.fetchEventsViaPropfind(fullUrl, auth, startTime, endTime);
  }

  // Try the calendar-query REPORT method (may not be supported by all servers)
  private async tryCalendarQueryReport(
    fullUrl: string,
    auth: string,
    startTime: Date,
    endTime: Date
  ): Promise<CalendarEvent[] | null> {
    const startStr = this.formatDateForCalDav(startTime);
    const endStr = this.formatDateForCalDav(endTime);

    const reportBody = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${startStr}" end="${endStr}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

    console.log('[Focus Planner] Trying CalDAV REPORT to:', fullUrl);

    const response = await requestUrl({
      url: fullUrl,
      method: 'REPORT',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/xml; charset=utf-8',
        'Depth': '1',
      },
      body: reportBody,
      throw: false,
    });

    console.log('[Focus Planner] CalDAV REPORT response status:', response.status);

    if (response.status === 207) {
      // Check if response actually contains calendar data or just hrefs
      // Feishu returns 404 for calendar-data in calendar-query, only giving us hrefs
      const hasActualCalendarData = response.text.includes('BEGIN:VCALENDAR');

      if (hasActualCalendarData) {
        console.log('[Focus Planner] REPORT contains calendar data, parsing directly');
        const events = this.parseCalDavResponse(response.text, startTime, endTime);
        console.log('[Focus Planner] Parsed events from REPORT:', events.length);
        return events;
      }

      // Feishu returns hrefs but not calendar data - extract hrefs and use multiget
      console.log('[Focus Planner] REPORT returned hrefs only, extracting .ics URLs');
      const icsHrefs: string[] = [];
      const hrefMatches = response.text.matchAll(/<D:href>([^<]+\.ics)<\/D:href>/gi);
      for (const match of hrefMatches) {
        icsHrefs.push(match[1]);
      }

      console.log('[Focus Planner] Found', icsHrefs.length, '.ics URLs from REPORT');

      if (icsHrefs.length > 0) {
        // Try calendar-multiget to fetch the actual data
        const multigetEvents = await this.tryCalendarMultiget(fullUrl, auth, icsHrefs, startTime, endTime);
        if (multigetEvents !== null) {
          return multigetEvents;
        }

        // Fallback to individual GET
        console.log('[Focus Planner] Multiget failed, trying individual GET');
        return await this.fetchEventsIndividually(auth, icsHrefs, startTime, endTime);
      }

      return [];
    }

    // REPORT not supported or failed
    console.log('[Focus Planner] CalDAV REPORT failed:', response.status);
    return null;
  }

  // Fallback: Use PROPFIND to list all .ics files, then GET each one
  private async fetchEventsViaPropfind(
    calendarUrl: string,
    auth: string,
    startTime: Date,
    endTime: Date
  ): Promise<CalendarEvent[]> {
    // First, list all resources in the calendar using simpler PROPFIND
    const propfindBody = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:getetag/>
    <d:getcontenttype/>
  </d:prop>
</d:propfind>`;

    console.log('[Focus Planner] CalDAV PROPFIND to list events:', calendarUrl);

    const listResponse = await requestUrl({
      url: calendarUrl,
      method: 'PROPFIND',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/xml; charset=utf-8',
        'Depth': '1',
      },
      body: propfindBody,
      throw: false,
    });

    console.log('[Focus Planner] PROPFIND list response:', listResponse.status);

    if (listResponse.status === 207) {
      // Extract hrefs of .ics files
      const icsHrefs: string[] = [];
      const hrefMatches = listResponse.text.matchAll(/<d:href>([^<]+\.ics)<\/d:href>/gi);
      for (const match of hrefMatches) {
        icsHrefs.push(match[1]);
      }

      // Also try without .ics extension - some servers use different formats
      if (icsHrefs.length === 0) {
        const allHrefs = listResponse.text.matchAll(/<d:href>([^<]+)<\/d:href>/gi);
        for (const match of allHrefs) {
          const href = match[1];
          // Skip the calendar URL itself and look for resource URLs
          if (href !== calendarUrl && href.length > calendarUrl.length) {
            icsHrefs.push(href);
          }
        }
      }

      console.log('[Focus Planner] Found', icsHrefs.length, 'resources');

      if (icsHrefs.length > 0) {
        // Try calendar-multiget REPORT first (more efficient)
        const multigetEvents = await this.tryCalendarMultiget(calendarUrl, auth, icsHrefs, startTime, endTime);
        if (multigetEvents !== null) {
          return multigetEvents;
        }

        // Fallback: GET each .ics file individually (slow but works everywhere)
        console.log('[Focus Planner] Falling back to individual GET requests');
        return await this.fetchEventsIndividually(auth, icsHrefs, startTime, endTime);
      }
    }

    // PROPFIND failed or returned no results - try direct calendar.ics export
    console.log('[Focus Planner] PROPFIND failed or empty, trying direct calendar export');
    return await this.tryDirectCalendarExport(calendarUrl, auth, startTime, endTime);
  }

  // Try to get the entire calendar as a single .ics file
  private async tryDirectCalendarExport(
    calendarUrl: string,
    auth: string,
    startTime: Date,
    endTime: Date
  ): Promise<CalendarEvent[]> {
    // Try common calendar export URLs
    const exportUrls = [
      calendarUrl.replace(/\/$/, '') + '.ics',
      calendarUrl.replace(/\/$/, '') + '/calendar.ics',
      calendarUrl + '?export',
    ];

    for (const url of exportUrls) {
      console.log('[Focus Planner] Trying calendar export URL:', url);

      const response = await requestUrl({
        url,
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'text/calendar',
        },
        throw: false,
      });

      console.log('[Focus Planner] Export response status:', response.status);

      if (response.status === 200 && response.text.includes('BEGIN:VCALENDAR')) {
        console.log('[Focus Planner] Got calendar data, parsing...');
        const events = this.parseICalendar(response.text, startTime, endTime);
        console.log('[Focus Planner] Parsed', events.length, 'events from export');
        return events;
      }
    }

    // Last resort: try listing the home directory and find calendars
    console.log('[Focus Planner] Export URLs failed, trying to discover calendars');

    // Try to GET the calendar URL directly (some servers respond with full calendar)
    const directResponse = await requestUrl({
      url: calendarUrl,
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'text/calendar, text/html, */*',
      },
      throw: false,
    });

    console.log('[Focus Planner] Direct GET response:', directResponse.status, 'content length:', directResponse.text.length);

    if (directResponse.status === 200 && directResponse.text.includes('BEGIN:VCALENDAR')) {
      const events = this.parseICalendar(directResponse.text, startTime, endTime);
      console.log('[Focus Planner] Parsed', events.length, 'events from direct GET');
      return events;
    }

    // Log the response for debugging
    console.log('[Focus Planner] Response preview:', directResponse.text.substring(0, 500));

    throw new Error('无法从 CalDAV 服务器获取日历数据，请检查配置');
  }

  // Try calendar-multiget REPORT to fetch multiple events at once
  private async tryCalendarMultiget(
    calendarUrl: string,
    auth: string,
    hrefs: string[],
    startTime: Date,
    endTime: Date
  ): Promise<CalendarEvent[] | null> {
    // Limit to 50 hrefs per request to avoid too large requests
    const batchSize = 50;
    const allEvents: CalendarEvent[] = [];

    for (let i = 0; i < hrefs.length; i += batchSize) {
      const batchHrefs = hrefs.slice(i, i + batchSize);

      // Use D: namespace prefix to match Feishu's response format
      const hrefElements = batchHrefs.map(href => `<D:href>${href}</D:href>`).join('\n    ');
      const multigetBody = `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  ${hrefElements}
</C:calendar-multiget>`;

      console.log('[Focus Planner] Trying calendar-multiget for', batchHrefs.length, 'items');

      const response = await requestUrl({
        url: calendarUrl,
        method: 'REPORT',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/xml; charset=utf-8',
          'Depth': '1',
        },
        body: multigetBody,
        throw: false,
      });

      console.log('[Focus Planner] calendar-multiget response:', response.status);

      if (response.status !== 207) {
        console.log('[Focus Planner] calendar-multiget failed:', response.status, response.text.substring(0, 500));
        return null; // Fall back to individual GET
      }

      // Check if we got actual calendar data
      const hasData = response.text.includes('BEGIN:VCALENDAR');
      console.log('[Focus Planner] Multiget response has calendar data:', hasData);

      if (hasData) {
        console.log('[Focus Planner] Multiget response preview:', response.text.substring(0, 2000));
      }

      const events = this.parseCalDavResponse(response.text, startTime, endTime);
      console.log('[Focus Planner] Parsed', events.length, 'events from multiget batch');
      allEvents.push(...events);
    }

    console.log('[Focus Planner] Total events from multiget:', allEvents.length);
    return allEvents;
  }

  // Fallback: GET each .ics file individually
  private async fetchEventsIndividually(
    auth: string,
    hrefs: string[],
    startTime: Date,
    endTime: Date
  ): Promise<CalendarEvent[]> {
    const events: CalendarEvent[] = [];

    // Limit to prevent too many requests
    const maxFetch = 200;
    const hrefsToFetch = hrefs.slice(0, maxFetch);

    console.log('[Focus Planner] Fetching', hrefsToFetch.length, 'ics files individually');

    for (const href of hrefsToFetch) {
      try {
        const fullUrl = href.startsWith('http') ? href : `${CALDAV_SERVER}${href}`;

        const response = await requestUrl({
          url: fullUrl,
          method: 'GET',
          headers: {
            'Authorization': `Basic ${auth}`,
          },
          throw: false,
        });

        if (response.status === 200) {
          const parsed = this.parseICalendar(response.text, startTime, endTime);
          events.push(...parsed);
        }
      } catch (e) {
        console.warn('[Focus Planner] Failed to fetch:', href, e);
      }
    }

    return events;
  }

  // Format date for CalDAV (UTC format)
  private formatDateForCalDav(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hour = String(date.getUTCHours()).padStart(2, '0');
    const minute = String(date.getUTCMinutes()).padStart(2, '0');
    const second = String(date.getUTCSeconds()).padStart(2, '0');
    return `${year}${month}${day}T${hour}${minute}${second}Z`;
  }

  // Parse CalDAV response containing iCalendar data
  private parseCalDavResponse(xml: string, queryStart: Date, queryEnd: Date): CalendarEvent[] {
    const events: CalendarEvent[] = [];

    // Try multiple patterns for calendar-data elements
    // Different CalDAV servers may use different namespace prefixes
    const patterns = [
      /<c:calendar-data[^>]*>([\s\S]*?)<\/c:calendar-data>/gi,
      /<cal:calendar-data[^>]*>([\s\S]*?)<\/cal:calendar-data>/gi,
      /<C:calendar-data[^>]*>([\s\S]*?)<\/C:calendar-data>/gi,
      /<CAL:calendar-data[^>]*>([\s\S]*?)<\/CAL:calendar-data>/gi,
      // Without namespace prefix
      /<calendar-data[^>]*>([\s\S]*?)<\/calendar-data>/gi,
    ];

    let matchCount = 0;
    for (const pattern of patterns) {
      const matches = xml.matchAll(pattern);
      for (const match of matches) {
        matchCount++;
        let icsData = match[1];

        console.log('[Focus Planner] Found calendar-data, length:', icsData.length);

        // Decode XML entities - Feishu uses &#xD;&#xA; for CRLF
        icsData = icsData
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&#xD;/gi, '\r')
          .replace(/&#xA;/gi, '\n')
          .replace(/&#13;/g, '\r')
          .replace(/&#10;/g, '\n');

        // Debug: show first 500 chars of decoded data
        if (matchCount <= 2) {
          console.log('[Focus Planner] Decoded calendar-data preview:', icsData.substring(0, 500));
        }

        // Parse iCalendar format
        const parsedEvents = this.parseICalendar(icsData, queryStart, queryEnd);
        console.log('[Focus Planner] Parsed', parsedEvents.length, 'events from this calendar-data');
        events.push(...parsedEvents);
      }
    }

    console.log('[Focus Planner] Total calendar-data elements found:', matchCount);

    // If no calendar-data found, try to find embedded VCALENDAR directly
    if (matchCount === 0 && xml.includes('BEGIN:VCALENDAR')) {
      console.log('[Focus Planner] No calendar-data tags found, but VCALENDAR exists in response');
      // Extract all VCALENDAR blocks
      const vcalMatches = xml.matchAll(/BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/g);
      for (const match of vcalMatches) {
        let icsData = match[0]
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&#xD;/gi, '\r')
          .replace(/&#xA;/gi, '\n')
          .replace(/&#13;/g, '\r')
          .replace(/&#10;/g, '\n');

        const parsedEvents = this.parseICalendar(icsData, queryStart, queryEnd);
        events.push(...parsedEvents);
      }
    }

    return events;
  }

  // Parse iCalendar (.ics) format
  private parseICalendar(icsData: string, queryStart: Date, queryEnd: Date): CalendarEvent[] {
    const events: CalendarEvent[] = [];

    // Unfold long lines (lines starting with space/tab are continuations)
    icsData = icsData.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');

    // Split into VEVENT blocks
    const veventMatches = icsData.matchAll(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g);

    for (const match of veventMatches) {
      const vevent = match[0];

      // Extract properties
      const uid = this.extractIcsProperty(vevent, 'UID');
      const summary = this.extractIcsProperty(vevent, 'SUMMARY');
      const dtstart = this.extractIcsProperty(vevent, 'DTSTART');
      const dtend = this.extractIcsProperty(vevent, 'DTEND');
      const rrule = this.extractIcsProperty(vevent, 'RRULE');
      const status = this.extractIcsProperty(vevent, 'STATUS');

      // Skip cancelled events
      if (status?.toUpperCase() === 'CANCELLED') {
        continue;
      }

      if (!dtstart) {
        console.log('[Focus Planner] Skipping event without DTSTART:', summary);
        continue;
      }

      // Parse start and end times
      const start = this.parseIcsDateTime(dtstart);
      const end = dtend ? this.parseIcsDateTime(dtend) : new Date(start.getTime() + 3600000); // Default 1 hour

      if (!start || !end) {
        console.log('[Focus Planner] Cannot parse dates for event:', summary);
        continue;
      }

      const duration = end.getTime() - start.getTime();
      const title = summary || 'Untitled Event';
      const category = this.categorizeEvent(title);

      // If no recurrence, check if in range
      if (!rrule) {
        if (end >= queryStart && start <= queryEnd) {
          events.push({
            id: `caldav-${uid || Date.now()}`,
            title,
            start,
            end,
            category,
            source: 'feishu',
            feishuEventId: uid || undefined,
          });
        }
        continue;
      }

      // Handle recurring events - CalDAV should already expand them
      // but some servers don't, so we handle it here too
      const instances = this.expandRecurrence(start, duration, rrule, queryStart, queryEnd);
      for (let i = 0; i < instances.length; i++) {
        const instanceStart = instances[i];
        events.push({
          id: `caldav-${uid || Date.now()}-${i}`,
          title,
          start: instanceStart,
          end: new Date(instanceStart.getTime() + duration),
          category,
          source: 'feishu',
          feishuEventId: uid || undefined,
        });
      }
    }

    return events;
  }

  // Extract a property from VEVENT
  private extractIcsProperty(vevent: string, property: string): string | null {
    // Handle properties with parameters like DTSTART;TZID=xxx:value
    const regex = new RegExp(`^${property}(?:;[^:]*)?:(.*)$`, 'im');
    const match = vevent.match(regex);
    return match ? match[1].trim() : null;
  }

  // Parse iCalendar date/time format
  private parseIcsDateTime(dtString: string): Date {
    // Remove any parameters prefix (e.g., from "20250106T090000")
    const cleanDt = dtString.replace(/^.*:/, '');

    // Handle different formats:
    // YYYYMMDD (all-day)
    // YYYYMMDDTHHMMSS (local time)
    // YYYYMMDDTHHMMSSZ (UTC)

    if (cleanDt.length === 8) {
      // All-day event: YYYYMMDD
      const year = parseInt(cleanDt.substring(0, 4));
      const month = parseInt(cleanDt.substring(4, 6)) - 1;
      const day = parseInt(cleanDt.substring(6, 8));
      return new Date(year, month, day, 9, 0, 0); // Default to 9 AM
    }

    if (cleanDt.endsWith('Z')) {
      // UTC time
      const year = parseInt(cleanDt.substring(0, 4));
      const month = parseInt(cleanDt.substring(4, 6)) - 1;
      const day = parseInt(cleanDt.substring(6, 8));
      const hour = parseInt(cleanDt.substring(9, 11));
      const minute = parseInt(cleanDt.substring(11, 13));
      const second = parseInt(cleanDt.substring(13, 15));
      return new Date(Date.UTC(year, month, day, hour, minute, second));
    }

    // Local time (no Z suffix)
    const year = parseInt(cleanDt.substring(0, 4));
    const month = parseInt(cleanDt.substring(4, 6)) - 1;
    const day = parseInt(cleanDt.substring(6, 8));
    const hour = parseInt(cleanDt.substring(9, 11)) || 0;
    const minute = parseInt(cleanDt.substring(11, 13)) || 0;
    const second = parseInt(cleanDt.substring(13, 15)) || 0;
    return new Date(year, month, day, hour, minute, second);
  }

  // Expand recurrence rule (same as feishuApi.ts)
  private expandRecurrence(eventStart: Date, duration: number, rrule: string, queryStart: Date, queryEnd: Date): Date[] {
    const instances: Date[] = [];

    const rules: Record<string, string> = {};
    for (const part of rrule.split(';')) {
      const [key, value] = part.split('=');
      if (key && value) {
        rules[key] = value;
      }
    }

    const freq = rules['FREQ'];
    const interval = parseInt(rules['INTERVAL'] || '1');
    const until = rules['UNTIL'] ? this.parseIcsDateTime(rules['UNTIL']) : null;
    const count = rules['COUNT'] ? parseInt(rules['COUNT']) : null;
    const byDay = rules['BYDAY']?.split(',') || [];

    let repeatEnd = queryEnd;
    if (until && until < repeatEnd) {
      repeatEnd = until;
    }

    let current = new Date(eventStart);
    let instanceCount = 0;
    const maxIterations = 1000;

    for (let i = 0; i < maxIterations && current <= repeatEnd; i++) {
      if (count && instanceCount >= count) break;

      const instanceEnd = new Date(current.getTime() + duration);
      if (instanceEnd >= queryStart && current <= queryEnd) {
        if (byDay.length === 0 || this.matchesByDay(current, byDay)) {
          instances.push(new Date(current));
          instanceCount++;
        }
      }

      switch (freq) {
        case 'DAILY':
          current.setDate(current.getDate() + interval);
          break;
        case 'WEEKLY':
          if (byDay.length > 0) {
            current.setDate(current.getDate() + 1);
          } else {
            current.setDate(current.getDate() + 7 * interval);
          }
          break;
        case 'MONTHLY':
          current.setMonth(current.getMonth() + interval);
          break;
        case 'YEARLY':
          current.setFullYear(current.getFullYear() + interval);
          break;
        default:
          return [];
      }
    }

    return instances;
  }

  private matchesByDay(date: Date, byDay: string[]): boolean {
    const dayMap: Record<number, string> = {
      0: 'SU', 1: 'MO', 2: 'TU', 3: 'WE', 4: 'TH', 5: 'FR', 6: 'SA'
    };
    const dayCode = dayMap[date.getDay()];
    return byDay.some(d => d.includes(dayCode));
  }

  // Categorize event based on title keywords
  private categorizeEvent(title: string): EventCategory {
    const lowerTitle = title.toLowerCase();

    const categoryOrder: EventCategory[] = [
      EventCategory.REST,
      EventCategory.MEETING,
      EventCategory.PERSONAL,
      EventCategory.ADMIN,
      EventCategory.FOCUS,
    ];

    for (const category of categoryOrder) {
      const keywords = this.categoryKeywords[category] || [];
      for (const keyword of keywords) {
        if (lowerTitle.includes(keyword.toLowerCase())) {
          return category;
        }
      }
    }

    return EventCategory.MEETING;
  }
}
