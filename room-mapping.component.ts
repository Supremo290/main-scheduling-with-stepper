import { Component, OnInit } from '@angular/core';
import { SharedDataService } from '../shared-data.service';

interface RoomAssignment {
  room: string;
  schedule: string; // e.g. "7:30 AM - 9:00 AM"
  subjectCode: string; // e.g. "A12" or "503"
  date: string;
}

@Component({
  selector: 'app-room-mapping',
  templateUrl: './room-mapping.component.html',
  styleUrls: ['./room-mapping.component.scss']
})
export class RoomMappingComponent implements OnInit {
  selectedScheduleOutput: any[] = []; // from student mapping
  roomList: string[] = [
    'A-201', 'A-202', 'A-206', 'A-210', 'A-211', 'A-212', 'A-213',
    'A-214', 'A-215', 'A-216', 'A-223', 'A-230', 'A-231', 'A-232',
    'A-233', 'A-301', 'A-313', 'A-314', 'A-315', 'A-316', 'A-317',
    'A-318', 'A-401', 'A-402', 'A-405', 'A-411', 'A-412'
  ];

  timeSlots: string[] = [
    '7:30 AM - 9:00 AM', '9:00 AM - 10:30 AM', '10:30 AM - 12:00 PM',
    '12:00 PM - 1:30 PM', '1:30 PM - 3:00 PM', '3:00 PM - 4:30 PM',
    '4:30 PM - 6:00 PM', '6:00 PM - 7:30 PM'
  ];

  roomAssignments: { [key: string]: { [key: string]: string } } = {}; 
  // e.g. roomAssignments['A-201']['7:30 AM - 9:00 AM'] = 'A12'

  constructor(private sharedData: SharedDataService) {}

 ngOnInit() {
  const storedStudentMapping = this.sharedData.getStudentMapping();
  if (storedStudentMapping) {
    this.selectedScheduleOutput = storedStudentMapping;
    console.log('📘 Loaded student mapping from localStorage:', this.selectedScheduleOutput);
  }

  const storedRooms = this.sharedData.getRoomMapping();
  if (storedRooms) {
    this.roomAssignments = storedRooms;
  } else {
    this.initializeRoomAssignments();
  }
}

  initializeRoomAssignments() {
    this.roomList.forEach(room => {
      this.roomAssignments[room] = {};
      this.timeSlots.forEach(slot => {
        this.roomAssignments[room][slot] = '';
      });
    });
  }

 getAvailableCodes(): string[] {
  const codes = new Set<string>();

  if (!this.selectedScheduleOutput || !Array.isArray(this.selectedScheduleOutput)) {
    return [];
  }

  this.selectedScheduleOutput.forEach(day => {
    if (!day.programs || !Array.isArray(day.programs)) return;

    day.programs.forEach((p: any) => {
      if (!p.subjects || !Array.isArray(p.subjects)) return;

      p.subjects.forEach((s: any) => {
        if (s.codeNo) codes.add(s.codeNo);
      });
    });
  });

  return Array.from(codes);
}


  onAssignCode(room: string, slot: string, event: any) {
  this.roomAssignments[room][slot] = event.target.value;
  this.sharedData.setRoomMapping(this.roomAssignments); // ✅ Save persistently
}


  saveToLocalStorage() {
    localStorage.setItem('roomAssignments', JSON.stringify(this.roomAssignments));
    this.sharedData.setRoomMapping(this.roomAssignments);
  }

  clearAll() {
    if (confirm('Clear all room assignments?')) {
      this.initializeRoomAssignments();
      this.saveToLocalStorage();
    }
  }
}
