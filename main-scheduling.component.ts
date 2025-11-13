import { Component, OnInit } from '@angular/core';
import { MatStepper } from '@angular/material/stepper';
import { SharedDataService } from '../shared-data.service';

@Component({
  selector: 'app-main-scheduling',
  templateUrl: './main-scheduling.component.html',
  styleUrls: ['./main-scheduling.component.scss']
})
export class MainSchedulingComponent implements OnInit {

  constructor(private sharedData: SharedDataService) { }

    goNext(stepper: MatStepper) {
    stepper.next();
  }

  ngOnInit() {
  }

  finish() {
    console.log('Scheduling complete!');
  }
}
