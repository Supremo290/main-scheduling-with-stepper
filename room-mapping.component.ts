import { Component, OnInit } from '@angular/core';
import { SubjectGroup, DepartmentGroup, ProgramSchedule, Rooms } from '../subject-code';
import { ApiService } from '../api.service';
import { GlobalService } from '../global.service';
import { SharedDataService } from '../shared-data.service';

interface RoomAssignment {
  room: string;
  schedule: string;
  subjectCode: string;
  date: string;
}

interface DateRoomSchedule {
  [date: string]: {
    [room: string]: {
      [slot: string]: string;
    };
  };
}

@Component({
  selector: 'app-room-mapping',
  templateUrl: './room-mapping.component.html',
  styleUrls: ['./room-mapping.component.scss']
})
export class RoomMappingComponent implements OnInit {
  codes: any[] = [];
  roomsData: Rooms[] = [];
  finalSchedule: any[] = [];
  selectedScheduleOutput: any[] = [];
  
  roomList: string[] = [];
  excludedRooms: string[] = [
    'B-11', 'B-12','BTL -','BUL -','HL','J-42','J-43','J-44','J-45','J-46','J-48','K-13',
    'K-14','K-22','K-24','K-41','L-23','M-21','M-31','M-33','M-43','MChem','MLab1','MLab2',
    'Nutri','SMTL','A-102','A-203','A-204','A-205','A-219','A-221','A-225','A-226','A-234',
    'A-302','A-306','A-308','A-309','A-310','A-311','A-312','DemoR','Pharm', 'TBA', 'to be', 
    'Virtu', 'EMC', 'Field', 'Hosp', 'Molec'
  ];
  uniqueRooms: string[] = [];
  
  examDates: string[] = [];
  selectedDate: string = '';
  
  timeSlots: string[] = [
    '7:30 AM - 9:00 AM', '9:00 AM - 10:30 AM', '10:30 AM - 12:00 PM',
    '12:00 PM - 1:30 PM', '1:30 PM - 3:00 PM', '3:00 PM - 4:30 PM',
    '4:30 PM - 6:00 PM', '6:00 PM - 7:30 PM'
  ];

  roomAssignments: DateRoomSchedule = {};
  availableCodesCache: { [dateSlot: string]: string[] } = {};

  constructor(
    private sharedData: SharedDataService,
    private api: ApiService,
    private global: GlobalService
  ) {}

  ngOnInit() {
    // Load student mapping data from SharedDataService
    const storedStudentMapping = this.sharedData.getStudentMapping();
    if (storedStudentMapping) {
      this.selectedScheduleOutput = storedStudentMapping;
      
      this.extractExamDates();
      this.buildAvailableCodesCache();
    }

    // Load room summary data
    const storedRoomData = this.sharedData.getRoomSummaryData();
    if (storedRoomData && storedRoomData.length) {
      this.codes = storedRoomData;
      this.extractRoomsData();
    }

    // Load saved room assignments
    const storedRooms = this.sharedData.getRoomMapping();
    if (storedRooms) {
      this.roomAssignments = storedRooms;
    } else {
      if (this.roomList.length > 0 && this.examDates.length > 0) {
        this.initializeRoomAssignments();
      }
    }

    // Subscribe to room summary updates
    this.sharedData.api$.subscribe(data => {
      if (data && data.length) {
        this.codes = data;
        this.extractRoomsData();
        
        if (Object.keys(this.roomAssignments).length === 0) {
          this.initializeRoomAssignments();
        }
      }
    });
  }

  extractExamDates() {
    if (!this.selectedScheduleOutput || !this.selectedScheduleOutput.length) {
      console.warn('⚠️ No student mapping available to extract dates');
      return;
    }

    this.examDates = this.selectedScheduleOutput.map(day => day.date);
    
    if (this.examDates.length > 0 && !this.selectedDate) {
      this.selectedDate = this.examDates[0];
    }

    console.log('📅 Extracted exam dates:', this.examDates);
  }

  buildAvailableCodesCache() {
    this.availableCodesCache = {};
    if (!this.selectedScheduleOutput || !Array.isArray(this.selectedScheduleOutput)) {
      console.warn("⚠️ No schedule output to build cache from");
      return;
    }

    this.selectedScheduleOutput.forEach(daySchedule => {
      const date = daySchedule.date;

      if (!daySchedule.programs || !Array.isArray(daySchedule.programs)) return;

      const slotCodesMap: { [slot: string]: Set<string> } = {};

      daySchedule.programs.forEach((p: any) => {
        if (!p.subjects || !Array.isArray(p.subjects)) return;

        p.subjects.forEach((s: any) => {
          if (s.sched && s.codeNo) {
            const slot = s.sched;
            const cacheKey = date + '_' + slot;

            if (!slotCodesMap[slot]) {
              slotCodesMap[slot] = new Set<string>();
            }
            slotCodesMap[slot].add(s.codeNo);
          }
        });
      });

      Object.keys(slotCodesMap).forEach(slot => {
        const cacheKey = date + '_' + slot;
        this.availableCodesCache[cacheKey] = Array.from(slotCodesMap[slot]);
      });
    });

    console.log('✅ Built available codes cache:', Object.keys(this.availableCodesCache).length, 'entries');
  }

  getAvailableCodesForSlot(date: string, slot: string): string[] {
    const cacheKey = date + '_' + slot;
    return this.availableCodesCache[cacheKey] || [];
  }

  getAvailableCodesForCurrentSlot(slot: string): string[] {
    if (!this.selectedDate) return [];
    return this.getAvailableCodesForSlot(this.selectedDate, slot);
  }

  onDateChange() {
    console.log("📅 Changed to date:", this.selectedDate);
    
    const hasExistingAssignments = this.checkIfDateHasAssignments();
    
    if (!hasExistingAssignments) {
      console.log("🔄 No existing assignments found, auto-assigning...");
      setTimeout(() => {
        this.autoAssignRooms();
      }, 100);
    } else {
      console.log("ℹ️ Date already has assignments");
    }
  }

  checkIfDateHasAssignments(): boolean {
    if (!this.selectedDate || !this.roomAssignments[this.selectedDate]) {
      return false;
    }

    for (const room of this.roomList) {
      if (!this.roomAssignments[this.selectedDate][room]) continue;

      for (const slot of this.timeSlots) {
        if (this.roomAssignments[this.selectedDate][room][slot]) {
          return true;
        }
      }
    }

    return false;
  }

  autoAssignRooms() {
    if (!this.selectedDate) {
      console.warn("⚠️ No date selected for auto-assignment");
      this.global.swalAlertError('Please select a date first');
      return;
    }

    console.log("🤖 Auto-assigning rooms for", this.selectedDate);

    const daySchedule = this.selectedScheduleOutput.find(d => d.date === this.selectedDate);
    if (!daySchedule) {
      console.warn("⚠️ No schedule found for", this.selectedDate);
      this.global.swalAlertError('No schedule found for selected date');
      return;
    }

    if (!this.roomAssignments[this.selectedDate]) {
      this.roomAssignments[this.selectedDate] = {};
    }

    // Initialize all room slots for this date
    this.roomList.forEach(room => {
      if (!this.roomAssignments[this.selectedDate][room]) {
        this.roomAssignments[this.selectedDate][room] = {};
      }
      this.timeSlots.forEach(slot => {
        this.roomAssignments[this.selectedDate][room][slot] = '';
      });
    });

    const assignedCodes = new Set<string>();

    // Assign codes to rooms for each time slot
    this.timeSlots.forEach(slot => {
      const codesForSlot = this.getAvailableCodesForSlot(this.selectedDate, slot);
      
      if (codesForSlot.length === 0) {
        console.log('⏭️ No codes scheduled for slot ' + slot);
        return;
      }

      console.log('📋 Assigning ' + codesForSlot.length + ' codes for slot ' + slot);

      // Sort rooms by capacity (largest first)
      const sortedRooms = this.roomList.slice().sort((a, b) => {
        return this.getRoomCapacity(b) - this.getRoomCapacity(a);
      });

      let roomIndex = 0;

      codesForSlot.forEach(code => {
        if (roomIndex >= sortedRooms.length) {
          console.warn('⚠️ Not enough rooms for all codes at slot ' + slot);
          return;
        }

        const room = sortedRooms[roomIndex];
        
        if (!this.roomAssignments[this.selectedDate][room][slot]) {
          this.roomAssignments[this.selectedDate][room][slot] = code;
          assignedCodes.add(code);
          console.log('✅ Assigned ' + code + ' to ' + room + ' at ' + slot);
          roomIndex++;
        }
      });
    });

    this.sharedData.setRoomMapping(this.roomAssignments);
    this.global.swalSuccess('✅ Auto-assigned ' + assignedCodes.size + ' codes to rooms!');
  }

  clearCurrentDate() {
    if (!this.selectedDate) {
      this.global.swalAlertError('Please select a date first');
      return;
    }

    if (!confirm('Clear all room assignments for ' + new Date(this.selectedDate).toLocaleDateString() + '?')) {
      return;
    }

    if (!this.roomAssignments[this.selectedDate]) {
      this.roomAssignments[this.selectedDate] = {};
    }

    this.roomList.forEach(room => {
      if (!this.roomAssignments[this.selectedDate][room]) {
        this.roomAssignments[this.selectedDate][room] = {};
      }
      this.timeSlots.forEach(slot => {
        this.roomAssignments[this.selectedDate][room][slot] = '';
      });
    });

    this.sharedData.setRoomMapping(this.roomAssignments);
    this.global.swalSuccess('Cleared assignments for selected date!');
  }

  extractRoomsData() {
    if (!this.codes || !this.codes.length) {
      console.warn("⚠️ No API data available to extract rooms");
      return;
    }

    this.extractUniqueRoomNumbers();
    this.roomsData = this.groupDataByRoom(this.codes);
    
    if (Object.keys(this.roomAssignments).length === 0) {
      this.initializeRoomAssignments();
    }
  }

  extractUniqueRoomNumbers() {
    const roomSet = new Set<string>();
    
    this.codes.forEach(item => {
      if (item.roomNumber && item.roomNumber.trim() !== '') {
        const roomNumber = item.roomNumber.trim();
        
        // Only add if NOT in exclusion list
        if (!this.excludedRooms.includes(roomNumber)) {
          roomSet.add(roomNumber);
        }
      }
    });

    this.uniqueRooms = Array.from(roomSet).sort((a, b) => {
      const splitA = a.split('-');
      const splitB = b.split('-');
      const buildingA = splitA[0];
      const buildingB = splitB[0];
      const numA = splitA[1];
      const numB = splitB[1];
      
      if (buildingA !== buildingB) {
        return buildingA.localeCompare(buildingB);
      }
      return parseInt(numA || '0') - parseInt(numB || '0');
    });

    this.roomList = this.uniqueRooms;
    console.log("🚫 Excluded Rooms:", this.excludedRooms);
    console.log("✅ Displaying Rooms:", this.roomList);
  }

  removeFromExclusion(room: string) {
    const index = this.excludedRooms.indexOf(room);
    if (index > -1) {
      this.excludedRooms.splice(index, 1);
      console.log('✅ Removed', room, 'from exclusion - it will now appear in the table');
      
      this.extractRoomsData();
    }
  }
  
  addToExclusion(room: string) {
    if (!this.excludedRooms.includes(room)) {
      this.excludedRooms.push(room);
      console.log('🚫 Added', room, 'to exclusion - it will be hidden from the table');
      
      this.extractRoomsData();
    }
  }
  
  clearAllExclusions() {
    const previousCount = this.excludedRooms.length;
    this.excludedRooms = [];
    console.log('✅ Cleared all exclusions - all', previousCount, 'rooms will now be displayed');
    
    this.extractRoomsData();
  }
  
  isRoomExcluded(room: string): boolean {
    return this.excludedRooms.includes(room);
  }

  groupDataByRoom(data: any[]): Rooms[] {
    const roomsMap = new Map<string, Rooms>();

    for (const item of data) {
      if (!item.roomNumber || item.roomNumber.trim() === '') continue;

      const roomNumber = item.roomNumber.trim();
      
      if (!roomsMap.has(roomNumber)) {
        roomsMap.set(roomNumber, {
          roomNumber: roomNumber,
          schedule: []
        });
      }

      const room = roomsMap.get(roomNumber);
      if (room) {
        room.schedule.push({
          subjectId: item.subjectId || '',
          codeNo: item.codeNo || '',
          course: item.course || '',
          yearLevel: item.yearLevel || 0,
          dept: item.dept || item.deptCode || '',
          day: item.day || '',
          time: item.time || '',
          units: parseInt(item.lecUnits) || 0
        });
      }
    }

    const roomsArray = Array.from(roomsMap.values());
    
    return roomsArray;
  }

  initializeRoomAssignments() {
    console.log("🔧 Initializing room assignments for", this.examDates.length, "dates and", this.roomList.length, "rooms");
    
    this.examDates.forEach(date => {
      if (!this.roomAssignments[date]) {
        this.roomAssignments[date] = {};
      }
      
      this.roomList.forEach(room => {
        if (!this.roomAssignments[date][room]) {
          this.roomAssignments[date][room] = {};
        }
        
        this.timeSlots.forEach(slot => {
          if (typeof this.roomAssignments[date][room][slot] === 'undefined') {
            this.roomAssignments[date][room][slot] = '';
          }
        });
      });
    });
  }

  onAssignCode(room: string, slot: string, event: any) {
    if (!this.selectedDate) {
      console.warn("⚠️ No date selected");
      return;
    }

    if (!this.roomAssignments[this.selectedDate]) {
      this.roomAssignments[this.selectedDate] = {};
    }
    if (!this.roomAssignments[this.selectedDate][room]) {
      this.roomAssignments[this.selectedDate][room] = {};
    }
    
    this.roomAssignments[this.selectedDate][room][slot] = event.target.value;
    this.sharedData.setRoomMapping(this.roomAssignments);
    console.log('✅ Assigned code to', room, slot, 'on', this.selectedDate, ':', event.target.value);
  }

  getCurrentAssignment(room: string, slot: string): string {
    if (!this.selectedDate) return '';
    return this.roomAssignments[this.selectedDate] && 
           this.roomAssignments[this.selectedDate][room] &&
           this.roomAssignments[this.selectedDate][room][slot] 
           ? this.roomAssignments[this.selectedDate][room][slot] 
           : '';
  }

  getRoomCapacity(roomNumber: string): number {
    if (!this.codes || !this.codes.length) return 0;
    
    const roomData = this.codes.find(item => item.roomNumber === roomNumber);
    return roomData && roomData.classSize ? roomData.classSize : 0;
  }

  getRoomSchedules(roomNumber: string): any[] {
    const room = this.roomsData.find(r => r.roomNumber === roomNumber);
    return room ? room.schedule : [];
  }

  getRoomDetails(roomNumber: string): any {
    const schedules = this.getRoomSchedules(roomNumber);
    const capacity = this.getRoomCapacity(roomNumber);
    
    return {
      roomNumber: roomNumber,
      capacity: capacity,
      totalSchedules: schedules.length,
      schedules: schedules
    };
  }

  displayAllRoomsInfo() {
    console.log("=== ALL ROOMS INFORMATION ===");
    
    this.roomList.forEach(roomNumber => {
      const details = this.getRoomDetails(roomNumber);
      console.log('Room: ' + details.roomNumber);
      console.log('Capacity: ' + details.capacity);
      console.log('Total Schedules: ' + details.totalSchedules);
      console.log('---');
    });
  }

  getRoomsWithCapacity(): { room: string, capacity: number }[] {
    return this.roomList.map(room => ({
      room: room,
      capacity: this.getRoomCapacity(room)
    }));
  }

  saveToLocalStorage() {
    this.sharedData.setRoomMapping(this.roomAssignments);
    this.global.swalSuccess('Room assignments saved successfully!');
  }

  clearAll() {
    if (!confirm('Clear all room assignments for ALL dates?')) {
      return;
    }

    this.examDates.forEach(date => {
      this.roomList.forEach(room => {
        if (!this.roomAssignments[date]) {
          this.roomAssignments[date] = {};
        }
        if (!this.roomAssignments[date][room]) {
          this.roomAssignments[date][room] = {};
        }
        this.timeSlots.forEach(slot => {
          this.roomAssignments[date][room][slot] = '';
        });
      });
    });

    this.saveToLocalStorage();
    this.global.swalSuccess('Cleared all room assignments!');
  }

  getRooms(data: any[]): Rooms[] {
    return this.groupDataByRoom(data);
  }

  getSubjectDetailsForCode(code: string, slot: string): any {
    if (!this.selectedDate || !code) return null;

    const daySchedule = this.selectedScheduleOutput.find(d => d.date === this.selectedDate);
    if (!daySchedule) return null;

    for (const program of daySchedule.programs) {
      if (!program.subjects || !Array.isArray(program.subjects)) continue;

      for (const subject of program.subjects) {
        if (subject.codeNo === code && subject.sched === slot) {
          return {
            subjectId: subject.subjectId,
            subjectTitle: subject.subjectTitle,
            codeNo: subject.codeNo
          };
        }
      }
    }

    return null;
  }
}