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
  
  // ✅ ADD: Track current exam group and term
  currentExamGroupName: string = '';
  activeTerm: string = '';
  
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
    console.log("🚀 Room Mapping Component Initialized");
    
    // ✅ FIX 1: Get current exam group and term
    const currentGroup = this.sharedData.getSelectedExamGroup();
    if (currentGroup) {
      this.currentExamGroupName = currentGroup.name;
      console.log("📋 Current exam group:", this.currentExamGroupName);
    }

    const savedTerm = this.sharedData.getActiveTerm();
    if (savedTerm) {
      this.activeTerm = savedTerm;
      console.log("📅 Current term:", this.activeTerm);
    }

    // ✅ FIX 2: Load student mapping for the current group
    this.loadStudentMappingData();

    // ✅ FIX 3: Subscribe to exam group changes
    this.sharedData.selectedExamGroup$.subscribe((group) => {
      if (group && group.name !== this.currentExamGroupName) {
        console.log("🔄 Exam group changed to:", group.name);
        this.currentExamGroupName = group.name;
        this.loadStudentMappingData();
      }
    });

    // ✅ FIX 4: Subscribe to term changes
    this.sharedData.activeTerm$.subscribe((term) => {
      if (term && term !== this.activeTerm) {
        console.log("🔄 Term changed to:", term);
        this.activeTerm = term;
        this.loadStudentMappingData();
      }
    });

    // Load room summary data
    const storedRoomData = this.sharedData.getRoomSummaryData();
    if (storedRoomData && storedRoomData.length) {
      console.log("✅ Loaded room data:", storedRoomData.length, "rooms");
      this.codes = storedRoomData;
      this.extractRoomsData();
    }

    // Load saved room assignments
    this.loadRoomAssignments();

    // Subscribe to room summary updates
    this.sharedData.api$.subscribe(data => {
      if (data && data.length) {
        console.log("🔄 Room data updated:", data.length, "items");
        this.codes = data;
        this.extractRoomsData();
        
        if (Object.keys(this.roomAssignments).length === 0) {
          this.initializeRoomAssignments();
        }
      }
    });
  }

  // ✅ NEW METHOD: Load student mapping data for current group
  private loadStudentMappingData() {
    if (!this.currentExamGroupName || !this.activeTerm) {
      console.warn("⚠️ Cannot load student mapping - missing group name or term");
      console.log("   Group:", this.currentExamGroupName);
      console.log("   Term:", this.activeTerm);
      return;
    }

    console.log("📖 Loading student mapping for:", this.currentExamGroupName, this.activeTerm);

    // Try to load from group-specific storage first
    const groupMapping = this.sharedData.getStudentMappingForGroup(
      this.currentExamGroupName,
      this.activeTerm
    );

    if (groupMapping && groupMapping.length > 0) {
      console.log("✅ Loaded group-specific student mapping:", groupMapping.length, "days");
      this.selectedScheduleOutput = groupMapping;
    } else {
      // Fallback to global storage
      const globalMapping = this.sharedData.getStudentMapping();
      if (globalMapping && globalMapping.length > 0) {
        console.log("✅ Loaded global student mapping:", globalMapping.length, "days");
        this.selectedScheduleOutput = globalMapping;
      } else {
        console.warn("⚠️ No student mapping data found");
        this.selectedScheduleOutput = [];
      }
    }

    if (this.selectedScheduleOutput.length > 0) {
      console.log("📊 Student mapping data:", this.selectedScheduleOutput);
      this.extractExamDates();
      this.buildAvailableCodesCache();
      this.loadRoomAssignments();
    }
  }

  // ✅ UPDATED METHOD: Load room assignments for current group
  private loadRoomAssignments() {
    if (!this.currentExamGroupName || !this.activeTerm) {
      console.warn("⚠️ Cannot load room assignments - missing group name or term");
      return;
    }

    // Try to load group-specific room assignments
    const storedRooms = this.sharedData.getRoomMappingForGroup(
      this.currentExamGroupName,
      this.activeTerm
    );

    if (storedRooms && Object.keys(storedRooms).length > 0) {
      console.log("✅ Loaded saved room assignments for group");
      this.roomAssignments = storedRooms;
    } else {
      // Initialize empty assignments
      if (this.roomList.length > 0 && this.examDates.length > 0) {
        console.log("🔧 Initializing new room assignments");
        this.initializeRoomAssignments();
      }
    }
  }

  extractExamDates() {
    if (!this.selectedScheduleOutput || !this.selectedScheduleOutput.length) {
      console.warn('⚠️ No student mapping available to extract dates');
      this.examDates = [];
      this.selectedDate = '';
      return;
    }

    this.examDates = this.selectedScheduleOutput.map(day => day.date);
    
    if (this.examDates.length > 0 && !this.selectedDate) {
      this.selectedDate = this.examDates[0];
      console.log("✅ Auto-selected first date:", this.selectedDate);
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

    // ✅ FIX: Save with group and term
    this.saveRoomAssignments();
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

    this.saveRoomAssignments();
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
    console.log("✅ Displaying Rooms:", this.roomList.length);
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
    this.saveRoomAssignments();
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

  // ✅ UPDATED: Save room assignments with group and term
  private saveRoomAssignments() {
    if (!this.currentExamGroupName || !this.activeTerm) {
      console.warn("⚠️ Cannot save - missing group name or term");
      return;
    }

    console.log("💾 Saving room assignments for:", this.currentExamGroupName, this.activeTerm);
    
    this.sharedData.setRoomMappingForGroup(
      this.currentExamGroupName,
      this.activeTerm,
      this.roomAssignments
    );
    
    console.log("✅ Room assignments saved");
  }

  saveToLocalStorage() {
    this.saveRoomAssignments();
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

    this.saveRoomAssignments();
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




































